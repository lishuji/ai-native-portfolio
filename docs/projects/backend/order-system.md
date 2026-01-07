---
sidebar_position: 1
title: 高并发订单系统
tags: [Go, MySQL, Redis, Kafka]
---

# 高并发订单系统

## 项目背景

### 业务挑战

- **日订单峰值**：500万+，大促期间瞬时 QPS 达 5万+
- **核心痛点**：库存超卖、订单重复、系统雪崩
- **业务要求**：RT < 200ms，错误率 < 0.01%

### 技术挑战

```
                    ┌─────────────────────────────────────────┐
                    │              挑战分析                    │
                    └─────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
   ┌────▼────┐                    ┌────▼────┐                    ┌────▼────┐
   │ 库存一致性 │                    │ 订单幂等 │                    │ 系统稳定性 │
   └────┬────┘                    └────┬────┘                    └────┬────┘
        │                              │                              │
   • 并发扣减超卖                   • 网络重试重复下单                 • 流量突增雪崩
   • 缓存与DB不一致                 • MQ 重复消费                    • 依赖服务超时
   • 分布式事务                     • 支付回调重复                   • 数据库连接耗尽
```

## 系统架构

### 整体架构

```
                                    ┌─────────────────┐
                                    │   Load Balancer │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
             ┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
             │  API Gateway │          │  API Gateway │          │  API Gateway │
             │  (限流/鉴权)  │          │  (限流/鉴权)  │          │  (限流/鉴权)  │
             └──────┬──────┘          └──────┬──────┘          └──────┬──────┘
                    │                        │                        │
                    └────────────────────────┼────────────────────────┘
                                             │
        ┌────────────────────────────────────┼────────────────────────────────────┐
        │                                    │                                    │
 ┌──────▼──────┐                      ┌──────▼──────┐                      ┌──────▼──────┐
 │ Order Service│                      │ Stock Service│                      │ Pay Service │
 │  (订单服务)   │                      │  (库存服务)   │                      │  (支付服务)  │
 └──────┬──────┘                      └──────┬──────┘                      └──────┬──────┘
        │                                    │                                    │
        └────────────────────────────────────┼────────────────────────────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
             ┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
             │    MySQL    │          │    Redis    │          │    Kafka    │
             │  (分库分表)   │          │  (缓存/锁)   │          │  (异步削峰)  │
             └─────────────┘          └─────────────┘          └─────────────┘
```

### 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 语言 | Go 1.21 | 高并发、低延迟、协程模型 |
| 框架 | Gin + Wire | 轻量级、依赖注入 |
| 数据库 | MySQL 8.0 | 成熟稳定、分库分表支持 |
| 缓存 | Redis 7.0 Cluster | 高性能、Lua 脚本支持 |
| 消息队列 | Kafka | 高吞吐、顺序消费 |
| 注册中心 | Nacos | 服务发现、配置中心 |

## 核心设计

### 1. 库存模型

#### 库存分层设计

```
┌─────────────────────────────────────────────────────────────┐
│                      库存分层架构                            │
└─────────────────────────────────────────────────────────────┘

  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │  展示库存    │     │  下单库存    │     │  实际库存    │
  │  (Redis)    │     │  (Redis)    │     │  (MySQL)    │
  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
         │                   │                   │
    用于前端展示          用于下单扣减          最终一致性保证
    允许短暂不一致        实时扣减              异步同步
```

#### Redis Lua 原子扣减

```lua
-- stock_deduct.lua
-- KEYS[1]: 库存 key
-- KEYS[2]: 幂等 key  
-- ARGV[1]: 扣减数量
-- ARGV[2]: 订单号
-- ARGV[3]: 过期时间

local stock_key = KEYS[1]
local idempotent_key = KEYS[2]
local quantity = tonumber(ARGV[1])
local order_id = ARGV[2]
local expire = tonumber(ARGV[3])

-- 幂等检查
local processed = redis.call("GET", idempotent_key)
if processed then
    if processed == order_id then
        return 1  -- 已处理，幂等返回
    else
        return -2 -- 幂等键冲突
    end
end

-- 库存检查
local stock = tonumber(redis.call("GET", stock_key) or 0)
if stock < quantity then
    return -1  -- 库存不足
end

-- 原子扣减
redis.call("DECRBY", stock_key, quantity)
redis.call("SETEX", idempotent_key, expire, order_id)

return 1  -- 成功
```

```go
// Go 调用
func (s *StockService) Deduct(ctx context.Context, productID int64, quantity int, orderID string) error {
    stockKey := fmt.Sprintf("stock:%d", productID)
    idempotentKey := fmt.Sprintf("stock_deduct:%s", orderID)
    
    result, err := s.deductScript.Run(ctx, s.redis,
        []string{stockKey, idempotentKey},
        quantity, orderID, 86400,
    ).Int()
    
    if err != nil {
        return fmt.Errorf("redis error: %w", err)
    }
    
    switch result {
    case 1:
        return nil
    case -1:
        return ErrStockInsufficient
    case -2:
        return ErrIdempotentConflict
    default:
        return ErrUnknown
    }
}
```

### 2. 订单幂等设计

#### Token + Redis 方案

```go
// 下单流程
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) (*Order, error) {
    // 1. 幂等检查
    idempotentKey := fmt.Sprintf("order:create:%s", req.IdempotencyKey)
    
    // 尝试设置处理标记
    ok, err := s.redis.SetNX(ctx, idempotentKey, "processing", 10*time.Minute).Result()
    if err != nil {
        return nil, err
    }
    
    if !ok {
        // 检查是否已完成
        val, _ := s.redis.Get(ctx, idempotentKey).Result()
        if strings.HasPrefix(val, "completed:") {
            orderID := strings.TrimPrefix(val, "completed:")
            return s.orderRepo.GetByID(ctx, orderID)
        }
        return nil, ErrOrderProcessing
    }
    
    // 2. 扣减库存
    if err := s.stockService.Deduct(ctx, req.ProductID, req.Quantity, req.IdempotencyKey); err != nil {
        s.redis.Del(ctx, idempotentKey)
        return nil, err
    }
    
    // 3. 创建订单
    order := &Order{
        ID:        s.idGen.Generate(),
        UserID:    req.UserID,
        ProductID: req.ProductID,
        Quantity:  req.Quantity,
        Amount:    req.Amount,
        Status:    OrderStatusPending,
    }
    
    if err := s.orderRepo.Create(ctx, order); err != nil {
        // 回滚库存
        s.stockService.Rollback(ctx, req.ProductID, req.Quantity, req.IdempotencyKey)
        s.redis.Del(ctx, idempotentKey)
        return nil, err
    }
    
    // 4. 标记完成
    s.redis.Set(ctx, idempotentKey, "completed:"+order.ID, 24*time.Hour)
    
    // 5. 发送订单创建消息
    s.mq.Send(ctx, "order.created", &OrderCreatedEvent{
        OrderID:   order.ID,
        UserID:    order.UserID,
        ProductID: order.ProductID,
        Amount:    order.Amount,
    })
    
    return order, nil
}
```

### 3. 分库分表设计

#### 分片策略

```go
// 按用户 ID 分库分表
type ShardRouter struct {
    dbCount    int // 数据库数量
    tableCount int // 每库表数量
}

func (r *ShardRouter) Route(userID int64) (dbIndex int, tableIndex int) {
    hash := userID % int64(r.dbCount*r.tableCount)
    dbIndex = int(hash) / r.tableCount
    tableIndex = int(hash) % r.tableCount
    return
}

func (r *ShardRouter) GetTableName(userID int64) string {
    _, tableIndex := r.Route(userID)
    return fmt.Sprintf("orders_%02d", tableIndex)
}

func (r *ShardRouter) GetDB(userID int64) *sql.DB {
    dbIndex, _ := r.Route(userID)
    return r.databases[dbIndex]
}
```

#### 分片后的查询

```go
// 分页查询用户订单
func (r *OrderRepo) ListByUserID(ctx context.Context, userID int64, page, pageSize int) ([]*Order, error) {
    db := r.router.GetDB(userID)
    table := r.router.GetTableName(userID)
    
    query := fmt.Sprintf(`
        SELECT id, user_id, product_id, quantity, amount, status, created_at
        FROM %s
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `, table)
    
    offset := (page - 1) * pageSize
    rows, err := db.QueryContext(ctx, query, userID, pageSize, offset)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var orders []*Order
    for rows.Next() {
        var o Order
        if err := rows.Scan(&o.ID, &o.UserID, &o.ProductID, &o.Quantity, &o.Amount, &o.Status, &o.CreatedAt); err != nil {
            return nil, err
        }
        orders = append(orders, &o)
    }
    
    return orders, nil
}
```

### 4. 异步削峰

#### Kafka 消息处理

```go
// 订单创建后异步处理
type OrderEventConsumer struct {
    orderService *OrderService
    redis        *redis.Client
}

func (c *OrderEventConsumer) HandleOrderCreated(ctx context.Context, msg *OrderCreatedEvent) error {
    // 幂等检查
    idempotentKey := fmt.Sprintf("order_event:%s", msg.OrderID)
    if !c.redis.SetNX(ctx, idempotentKey, "1", 7*24*time.Hour).Val() {
        return nil // 已处理
    }
    
    // 异步任务
    var errs []error
    
    // 1. 发送订单确认通知
    if err := c.notifyService.SendOrderConfirmation(ctx, msg); err != nil {
        errs = append(errs, fmt.Errorf("send notification: %w", err))
    }
    
    // 2. 更新用户统计
    if err := c.statsService.UpdateUserStats(ctx, msg.UserID); err != nil {
        errs = append(errs, fmt.Errorf("update stats: %w", err))
    }
    
    // 3. 同步到数据仓库
    if err := c.syncService.SyncToWarehouse(ctx, msg); err != nil {
        errs = append(errs, fmt.Errorf("sync warehouse: %w", err))
    }
    
    if len(errs) > 0 {
        // 部分失败，清除幂等标记，允许重试
        c.redis.Del(ctx, idempotentKey)
        return errors.Join(errs...)
    }
    
    return nil
}
```

### 5. 限流熔断

#### 多维度限流

```go
// API 限流中间件
func RateLimitMiddleware(limiter *MultiDimensionLimiter) gin.HandlerFunc {
    return func(c *gin.Context) {
        ctx := c.Request.Context()
        userID := c.GetString("user_id")
        clientIP := c.ClientIP()
        path := c.Request.URL.Path
        
        // 全局限流
        if !limiter.AllowGlobal(ctx, path) {
            c.JSON(http.StatusTooManyRequests, gin.H{"error": "系统繁忙，请稍后重试"})
            c.Abort()
            return
        }
        
        // 用户级限流
        if userID != "" && !limiter.AllowUser(ctx, userID) {
            c.JSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁"})
            c.Abort()
            return
        }
        
        // IP 级限流
        if !limiter.AllowIP(ctx, clientIP) {
            c.JSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁"})
            c.Abort()
            return
        }
        
        c.Next()
    }
}
```

#### 熔断降级

```go
// 库存服务熔断
type StockServiceBreaker struct {
    breaker *gobreaker.CircuitBreaker
    service *StockService
}

func NewStockServiceBreaker(service *StockService) *StockServiceBreaker {
    settings := gobreaker.Settings{
        Name:        "stock-service",
        MaxRequests: 100,                // 半开状态最大请求数
        Interval:    10 * time.Second,   // 统计周期
        Timeout:     30 * time.Second,   // 熔断超时
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            // 错误率 > 50% 或连续失败 > 10 次触发熔断
            failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
            return counts.Requests >= 10 && (failureRatio >= 0.5 || counts.ConsecutiveFailures >= 10)
        },
        OnStateChange: func(name string, from, to gobreaker.State) {
            log.Warn("circuit breaker state changed",
                "name", name,
                "from", from.String(),
                "to", to.String(),
            )
        },
    }
    
    return &StockServiceBreaker{
        breaker: gobreaker.NewCircuitBreaker(settings),
        service: service,
    }
}

func (b *StockServiceBreaker) Deduct(ctx context.Context, productID int64, quantity int, orderID string) error {
    result, err := b.breaker.Execute(func() (interface{}, error) {
        return nil, b.service.Deduct(ctx, productID, quantity, orderID)
    })
    
    if err == gobreaker.ErrOpenState {
        return ErrServiceUnavailable
    }
    
    _ = result
    return err
}
```

## 性能优化

### 1. 批量写入

```go
// 批量插入订单明细
func (r *OrderItemRepo) BatchCreate(ctx context.Context, items []*OrderItem) error {
    if len(items) == 0 {
        return nil
    }
    
    const batchSize = 500
    for i := 0; i < len(items); i += batchSize {
        end := i + batchSize
        if end > len(items) {
            end = len(items)
        }
        
        batch := items[i:end]
        if err := r.batchInsert(ctx, batch); err != nil {
            return err
        }
    }
    
    return nil
}

func (r *OrderItemRepo) batchInsert(ctx context.Context, items []*OrderItem) error {
    valueStrings := make([]string, 0, len(items))
    valueArgs := make([]interface{}, 0, len(items)*5)
    
    for _, item := range items {
        valueStrings = append(valueStrings, "(?, ?, ?, ?, ?)")
        valueArgs = append(valueArgs, item.ID, item.OrderID, item.ProductID, item.Quantity, item.UnitPrice)
    }
    
    query := fmt.Sprintf(
        "INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES %s",
        strings.Join(valueStrings, ","),
    )
    
    _, err := r.db.ExecContext(ctx, query, valueArgs...)
    return err
}
```

### 2. Redis Pipeline

```go
// 批量查询库存
func (s *StockService) BatchGetStock(ctx context.Context, productIDs []int64) (map[int64]int, error) {
    pipe := s.redis.Pipeline()
    
    cmds := make(map[int64]*redis.StringCmd)
    for _, id := range productIDs {
        key := fmt.Sprintf("stock:%d", id)
        cmds[id] = pipe.Get(ctx, key)
    }
    
    _, err := pipe.Exec(ctx)
    if err != nil && err != redis.Nil {
        return nil, err
    }
    
    result := make(map[int64]int)
    for id, cmd := range cmds {
        val, err := cmd.Int()
        if err == redis.Nil {
            result[id] = 0
        } else if err != nil {
            return nil, err
        } else {
            result[id] = val
        }
    }
    
    return result, nil
}
```

### 3. 连接池优化

```go
// 数据库连接池配置
func NewDBPool(dsn string) (*sql.DB, error) {
    db, err := sql.Open("mysql", dsn)
    if err != nil {
        return nil, err
    }
    
    // 根据压测结果调优
    db.SetMaxOpenConns(200)              // 最大连接数
    db.SetMaxIdleConns(50)               // 最大空闲连接
    db.SetConnMaxLifetime(30 * time.Minute) // 连接最大生命周期
    db.SetConnMaxIdleTime(5 * time.Minute)  // 空闲连接超时
    
    return db, nil
}

// Redis 连接池配置
func NewRedisClient(addr string) *redis.Client {
    return redis.NewClient(&redis.Options{
        Addr:         addr,
        PoolSize:     200,
        MinIdleConns: 20,
        MaxRetries:   3,
        DialTimeout:  3 * time.Second,
        ReadTimeout:  2 * time.Second,
        WriteTimeout: 2 * time.Second,
        PoolTimeout:  4 * time.Second,
    })
}
```

## 监控告警

### 关键指标

```go
var (
    // 订单指标
    orderCreateTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "order_create_total",
            Help: "Total order creations",
        },
        []string{"status"}, // success, failed, rejected
    )
    
    orderCreateDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "order_create_duration_seconds",
            Help:    "Order creation duration",
            Buckets: []float64{0.01, 0.05, 0.1, 0.2, 0.5, 1, 2},
        },
        []string{},
    )
    
    // 库存指标
    stockDeductTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "stock_deduct_total",
            Help: "Total stock deductions",
        },
        []string{"status"}, // success, insufficient, conflict
    )
    
    // 熔断指标
    circuitBreakerState = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "circuit_breaker_state",
            Help: "Circuit breaker state (0=closed, 1=half-open, 2=open)",
        },
        []string{"name"},
    )
)
```

## 项目成果

### 性能指标

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 平均 RT | 350ms | 120ms | **↓ 66%** |
| P99 RT | 1200ms | 450ms | **↓ 63%** |
| 吞吐量 | 8000 QPS | 25000 QPS | **↑ 212%** |
| 错误率 | 0.5% | 0.008% | **↓ 98%** |

### 稳定性指标

- **可用性**：99.99%（全年故障时间 < 53 分钟）
- **库存准确率**：100%（零超卖）
- **订单重复率**：0%（幂等保障）

### 技术亮点

1. **Redis Lua 原子操作** - 解决库存扣减一致性
2. **多维度幂等设计** - Token + 数据库唯一约束 + 状态机
3. **分库分表** - 支撑亿级订单数据
4. **异步削峰** - Kafka 解耦，平滑流量峰值
5. **熔断降级** - 保障系统稳定性

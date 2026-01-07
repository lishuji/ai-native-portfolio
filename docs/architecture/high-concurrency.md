---
sidebar_position: 1
---

# 高并发系统设计

高并发是后端工程师的核心能力之一。本文将系统性地介绍高并发场景下的设计原则、技术方案和实战经验。

## 高并发的本质

高并发的核心挑战是**在有限资源下处理大量请求**。解决思路无非三个方向：

1. **减少请求** - 缓存、合并、限流
2. **加快处理** - 异步、并行、优化
3. **增加资源** - 水平扩展、弹性伸缩

```
                    ┌─────────────────────────────────────────┐
                    │              高并发三板斧                │
                    └─────────────────────────────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
    ┌──────▼──────┐             ┌──────▼──────┐             ┌──────▼──────┐
    │   减少请求   │             │   加快处理   │             │   增加资源   │
    └──────┬──────┘             └──────┬──────┘             └──────┬──────┘
           │                           │                           │
    ┌──────┴──────┐             ┌──────┴──────┐             ┌──────┴──────┐
    │ • 多级缓存   │             │ • 异步处理   │             │ • 水平扩展   │
    │ • 请求合并   │             │ • 并行计算   │             │ • 读写分离   │
    │ • 限流降级   │             │ • 算法优化   │             │ • 分库分表   │
    │ • CDN 加速   │             │ • 连接池化   │             │ • 弹性伸缩   │
    └─────────────┘             └─────────────┘             └─────────────┘
```

## 缓存架构

### 多级缓存设计

```
请求 ──► 本地缓存 ──► 分布式缓存 ──► 数据库
           │              │              │
         10μs          1ms           10ms
```

```go
// Go 多级缓存实现
type MultiLevelCache struct {
    local   *LocalCache    // 本地缓存 (进程内)
    redis   *RedisClient   // 分布式缓存
    db      *Database      // 数据库
    sfGroup singleflight.Group
}

func (c *MultiLevelCache) Get(ctx context.Context, key string) (interface{}, error) {
    // 1. 查本地缓存
    if val, ok := c.local.Get(key); ok {
        return val, nil
    }
    
    // 2. 查 Redis
    val, err := c.redis.Get(ctx, key)
    if err == nil {
        c.local.Set(key, val, 10*time.Second)
        return val, nil
    }
    
    // 3. 查数据库 (singleflight 防止缓存击穿)
    val, err, _ = c.sfGroup.Do(key, func() (interface{}, error) {
        return c.db.Query(ctx, key)
    })
    if err != nil {
        return nil, err
    }
    
    // 回填缓存
    c.redis.Set(ctx, key, val, 5*time.Minute)
    c.local.Set(key, val, 10*time.Second)
    
    return val, nil
}
```

### 缓存一致性

| 策略 | 实现方式 | 一致性 | 适用场景 |
|------|----------|--------|----------|
| Cache Aside | 先更新DB，再删缓存 | 最终一致 | 通用场景 |
| Read/Write Through | 缓存代理读写 | 强一致 | 读多写少 |
| Write Behind | 异步批量写DB | 弱一致 | 写密集型 |

```go
// Cache Aside + 延迟双删
func (s *Service) UpdateUser(ctx context.Context, user *User) error {
    // 1. 删除缓存
    s.cache.Delete(ctx, userCacheKey(user.ID))
    
    // 2. 更新数据库
    if err := s.db.UpdateUser(ctx, user); err != nil {
        return err
    }
    
    // 3. 延迟双删
    go func() {
        time.Sleep(500 * time.Millisecond)
        s.cache.Delete(context.Background(), userCacheKey(user.ID))
    }()
    
    return nil
}
```

## 限流设计

### 常见限流算法

| 算法 | 特点 | 适用场景 |
|------|------|----------|
| 固定窗口 | 实现简单，有边界问题 | 粗粒度限流 |
| 滑动窗口 | 平滑，内存占用大 | 精确限流 |
| 漏桶 | 恒定速率，无法应对突发 | 流量整形 |
| 令牌桶 | 允许突发，最常用 | API 限流 |

### Redis + Lua 令牌桶

```lua
-- token_bucket.lua
local key = KEYS[1]
local rate = tonumber(ARGV[1])      -- 每秒生成令牌数
local capacity = tonumber(ARGV[2])  -- 桶容量
local now = tonumber(ARGV[3])       -- 当前时间戳(毫秒)
local requested = tonumber(ARGV[4]) -- 请求令牌数

local bucket = redis.call('HMGET', key, 'tokens', 'last_time')
local tokens = tonumber(bucket[1]) or capacity
local last_time = tonumber(bucket[2]) or now

-- 计算新增令牌
local delta = (now - last_time) * rate / 1000
tokens = math.min(capacity, tokens + delta)

-- 判断是否有足够令牌
if tokens >= requested then
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'last_time', now)
    redis.call('EXPIRE', key, 60)
    return 1  -- 允许
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_time', now)
    redis.call('EXPIRE', key, 60)
    return 0  -- 拒绝
end
```

```go
// Go 限流器
type RateLimiter struct {
    redis  *redis.Client
    script *redis.Script
}

func (r *RateLimiter) Allow(ctx context.Context, key string, rate, capacity int) bool {
    now := time.Now().UnixMilli()
    result, err := r.script.Run(ctx, r.redis, []string{key}, rate, capacity, now, 1).Int()
    if err != nil {
        return true // 降级放行
    }
    return result == 1
}
```

### 分布式限流

```go
// 多维度限流
type MultiDimensionLimiter struct {
    limiters map[string]*RateLimiter
}

func (m *MultiDimensionLimiter) Allow(ctx context.Context, req *Request) bool {
    // 1. 全局限流
    if !m.limiters["global"].Allow(ctx, "global", 10000, 10000) {
        return false
    }
    
    // 2. 用户级限流
    userKey := fmt.Sprintf("user:%s", req.UserID)
    if !m.limiters["user"].Allow(ctx, userKey, 100, 100) {
        return false
    }
    
    // 3. IP 级限流
    ipKey := fmt.Sprintf("ip:%s", req.ClientIP)
    if !m.limiters["ip"].Allow(ctx, ipKey, 50, 50) {
        return false
    }
    
    return true
}
```

## 异步处理

### 消息队列削峰

```
同步模式:  请求 ──► 处理 ──► 响应  (高延迟，易超时)

异步模式:  请求 ──► 入队 ──► 响应  (低延迟)
                     │
                     ▼
           消费者 ──► 处理 ──► 通知
```

```go
// 订单创建 - 异步处理
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) (*Order, error) {
    // 1. 参数校验
    if err := req.Validate(); err != nil {
        return nil, err
    }
    
    // 2. 创建订单 (状态: pending)
    order := &Order{
        ID:     uuid.New(),
        UserID: req.UserID,
        Status: OrderStatusPending,
        Items:  req.Items,
    }
    
    if err := s.orderRepo.Create(ctx, order); err != nil {
        return nil, err
    }
    
    // 3. 发送消息到队列
    msg := &OrderCreatedEvent{
        OrderID: order.ID,
        UserID:  order.UserID,
        Items:   order.Items,
    }
    if err := s.mq.Publish(ctx, "order.created", msg); err != nil {
        // 消息发送失败，标记订单需要重试
        s.orderRepo.MarkRetry(ctx, order.ID)
    }
    
    return order, nil
}

// 消费者处理
func (s *OrderConsumer) HandleOrderCreated(ctx context.Context, msg *OrderCreatedEvent) error {
    // 1. 幂等检查
    if s.isProcessed(ctx, msg.OrderID) {
        return nil
    }
    
    // 2. 扣减库存
    if err := s.stockService.Deduct(ctx, msg.Items); err != nil {
        return err
    }
    
    // 3. 更新订单状态
    if err := s.orderRepo.UpdateStatus(ctx, msg.OrderID, OrderStatusConfirmed); err != nil {
        return err
    }
    
    // 4. 标记已处理
    s.markProcessed(ctx, msg.OrderID)
    
    return nil
}
```

## 数据库优化

### 读写分离

```go
// 读写分离数据源
type DBCluster struct {
    master *sql.DB
    slaves []*sql.DB
    idx    uint64
}

func (c *DBCluster) Master() *sql.DB {
    return c.master
}

func (c *DBCluster) Slave() *sql.DB {
    // 轮询选择从库
    idx := atomic.AddUint64(&c.idx, 1)
    return c.slaves[idx%uint64(len(c.slaves))]
}

// 使用示例
func (r *UserRepo) GetByID(ctx context.Context, id string) (*User, error) {
    db := r.cluster.Slave() // 读从库
    return r.queryUser(ctx, db, id)
}

func (r *UserRepo) Create(ctx context.Context, user *User) error {
    db := r.cluster.Master() // 写主库
    return r.insertUser(ctx, db, user)
}
```

### 分库分表

```go
// 分表路由
type ShardRouter struct {
    shardCount int
}

func (r *ShardRouter) GetTableName(userID string) string {
    hash := crc32.ChecksumIEEE([]byte(userID))
    shard := hash % uint32(r.shardCount)
    return fmt.Sprintf("orders_%d", shard)
}

// 分库路由
func (r *ShardRouter) GetDB(userID string) *sql.DB {
    hash := crc32.ChecksumIEEE([]byte(userID))
    dbIdx := hash % uint32(len(r.databases))
    return r.databases[dbIdx]
}
```

### 批量操作

```go
// 批量插入
func (r *OrderRepo) BatchCreate(ctx context.Context, orders []*Order) error {
    if len(orders) == 0 {
        return nil
    }
    
    const batchSize = 1000
    for i := 0; i < len(orders); i += batchSize {
        end := i + batchSize
        if end > len(orders) {
            end = len(orders)
        }
        
        batch := orders[i:end]
        if err := r.batchInsert(ctx, batch); err != nil {
            return err
        }
    }
    
    return nil
}

// 使用 COPY 协议 (PostgreSQL)
func (r *OrderRepo) batchInsert(ctx context.Context, orders []*Order) error {
    txn, err := r.db.Begin()
    if err != nil {
        return err
    }
    defer txn.Rollback()
    
    stmt, err := txn.Prepare(pq.CopyIn("orders", "id", "user_id", "amount", "status"))
    if err != nil {
        return err
    }
    
    for _, order := range orders {
        _, err = stmt.Exec(order.ID, order.UserID, order.Amount, order.Status)
        if err != nil {
            return err
        }
    }
    
    _, err = stmt.Exec()
    if err != nil {
        return err
    }
    
    return txn.Commit()
}
```

## 连接池优化

```go
// 数据库连接池配置
func NewDBPool(dsn string) (*sql.DB, error) {
    db, err := sql.Open("mysql", dsn)
    if err != nil {
        return nil, err
    }
    
    // 连接池配置
    db.SetMaxOpenConns(100)           // 最大连接数
    db.SetMaxIdleConns(20)            // 最大空闲连接
    db.SetConnMaxLifetime(time.Hour)  // 连接最大生命周期
    db.SetConnMaxIdleTime(10 * time.Minute) // 空闲连接超时
    
    return db, nil
}

// Redis 连接池配置
func NewRedisPool(addr string) *redis.Client {
    return redis.NewClient(&redis.Options{
        Addr:         addr,
        PoolSize:     100,           // 连接池大小
        MinIdleConns: 10,            // 最小空闲连接
        MaxRetries:   3,             // 最大重试次数
        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,
    })
}
```

## 性能监控

```go
// Prometheus 指标
var (
    requestTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total HTTP requests",
        },
        []string{"method", "path", "status"},
    )
    
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request duration",
            Buckets: []float64{0.01, 0.05, 0.1, 0.5, 1, 5},
        },
        []string{"method", "path"},
    )
    
    dbQueryDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "db_query_duration_seconds",
            Help:    "Database query duration",
            Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5},
        },
        []string{"query_type"},
    )
)

// 监控中间件
func MetricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        
        rw := &responseWriter{ResponseWriter: w, statusCode: 200}
        next.ServeHTTP(rw, r)
        
        duration := time.Since(start).Seconds()
        
        requestTotal.WithLabelValues(r.Method, r.URL.Path, strconv.Itoa(rw.statusCode)).Inc()
        requestDuration.WithLabelValues(r.Method, r.URL.Path).Observe(duration)
    })
}
```

## 压测与调优

### 压测工具

```bash
# wrk 压测
wrk -t12 -c400 -d30s --latency http://localhost:8080/api/users

# vegeta 压测
echo "GET http://localhost:8080/api/users" | vegeta attack -duration=30s -rate=1000 | vegeta report

# k6 压测脚本
# k6 run script.js
```

### 调优清单

| 层级 | 检查项 | 优化手段 |
|------|--------|----------|
| 应用层 | 慢接口 | 异步化、缓存、算法优化 |
| 数据库 | 慢查询 | 索引优化、SQL 改写 |
| 缓存 | 命中率 | 预热、热点处理 |
| 网络 | 连接数 | 连接池、长连接 |
| 系统 | CPU/内存 | 资源扩容、GC 调优 |

## 总结

高并发系统设计的核心要点：

1. **缓存为王** - 多级缓存、热点处理、一致性保障
2. **异步解耦** - 消息队列削峰、异步处理
3. **限流保护** - 多维度限流、熔断降级
4. **数据库优化** - 读写分离、分库分表、批量操作
5. **连接池化** - 复用连接、减少开销
6. **监控先行** - 指标埋点、链路追踪

没有银弹，只有根据业务场景选择合适的技术方案。

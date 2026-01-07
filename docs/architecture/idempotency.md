---
sidebar_position: 3
---

# 幂等性设计

幂等性是分布式系统的基石。一个操作无论执行多少次，结果都相同，这就是幂等性。本文将深入探讨幂等性的实现方案和最佳实践。

## 为什么需要幂等性

在分布式系统中，以下场景可能导致重复请求：

```
┌─────────────────────────────────────────────────────────────┐
│                     重复请求的来源                           │
└─────────────────────────────────────────────────────────────┘

1. 用户重复点击
   用户 ──► [点击] ──► [再点击] ──► 服务端

2. 网络超时重试
   客户端 ──► 请求 ──► 服务端处理成功
              ↓ 响应丢失
           超时重试 ──► 服务端再次处理

3. 消息队列重复投递
   MQ ──► 消费成功 ──► ACK 失败 ──► 重新投递

4. 服务调用重试
   服务A ──► 调用服务B ──► 超时 ──► 重试
```

### 不幂等的后果

- **重复扣款** - 用户被多次扣费
- **重复下单** - 生成多个相同订单
- **库存超卖** - 库存被多次扣减
- **数据不一致** - 业务状态混乱

## 幂等性设计原则

### HTTP 方法的幂等性

| 方法 | 幂等 | 说明 |
|------|------|------|
| GET | ✅ | 读取操作，天然幂等 |
| HEAD | ✅ | 同 GET |
| PUT | ✅ | 全量更新，结果确定 |
| DELETE | ✅ | 删除操作，多次删除结果相同 |
| POST | ❌ | 创建资源，需要额外处理 |
| PATCH | ❌ | 增量更新，需要额外处理 |

### 幂等 vs 非幂等操作

```go
// 幂等操作
UPDATE users SET balance = 100 WHERE id = 1;  // 多次执行结果相同
DELETE FROM orders WHERE id = 123;             // 多次执行结果相同

// 非幂等操作
UPDATE users SET balance = balance - 10 WHERE id = 1;  // 每次执行余额减少
INSERT INTO orders (user_id, amount) VALUES (1, 100);  // 每次执行创建新记录
```

## 实现方案

### 1. 唯一请求 ID

最通用的幂等方案，客户端生成唯一请求 ID。

```go
// 幂等性中间件
type IdempotencyMiddleware struct {
    redis *redis.Client
    ttl   time.Duration
}

func (m *IdempotencyMiddleware) Handle(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 只处理非幂等方法
        if r.Method == "GET" || r.Method == "HEAD" {
            next.ServeHTTP(w, r)
            return
        }
        
        // 获取幂等 Key
        idempotencyKey := r.Header.Get("X-Idempotency-Key")
        if idempotencyKey == "" {
            next.ServeHTTP(w, r)
            return
        }
        
        ctx := r.Context()
        cacheKey := fmt.Sprintf("idempotency:%s", idempotencyKey)
        
        // 尝试获取缓存的响应
        cached, err := m.redis.Get(ctx, cacheKey).Bytes()
        if err == nil {
            // 返回缓存的响应
            var resp CachedResponse
            json.Unmarshal(cached, &resp)
            for k, v := range resp.Headers {
                w.Header().Set(k, v)
            }
            w.WriteHeader(resp.StatusCode)
            w.Write(resp.Body)
            return
        }
        
        // 尝试获取处理锁
        lockKey := cacheKey + ":lock"
        locked, err := m.redis.SetNX(ctx, lockKey, "1", 30*time.Second).Result()
        if err != nil || !locked {
            // 正在处理中
            http.Error(w, "Request is being processed", http.StatusConflict)
            return
        }
        defer m.redis.Del(ctx, lockKey)
        
        // 包装 ResponseWriter 以捕获响应
        rw := &responseCapture{ResponseWriter: w}
        next.ServeHTTP(rw, r)
        
        // 缓存响应
        resp := CachedResponse{
            StatusCode: rw.statusCode,
            Headers:    extractHeaders(rw.Header()),
            Body:       rw.body.Bytes(),
        }
        data, _ := json.Marshal(resp)
        m.redis.Set(ctx, cacheKey, data, m.ttl)
    })
}

type CachedResponse struct {
    StatusCode int               `json:"status_code"`
    Headers    map[string]string `json:"headers"`
    Body       []byte            `json:"body"`
}
```

### 2. Token 机制

服务端生成 Token，客户端使用 Token 提交。

```go
// Token 服务
type TokenService struct {
    redis *redis.Client
}

// 生成 Token
func (s *TokenService) GenerateToken(ctx context.Context, bizType string) (string, error) {
    token := uuid.New().String()
    key := fmt.Sprintf("token:%s:%s", bizType, token)
    
    // Token 有效期 10 分钟
    err := s.redis.Set(ctx, key, "1", 10*time.Minute).Err()
    if err != nil {
        return "", err
    }
    
    return token, nil
}

// 消费 Token（原子操作）
func (s *TokenService) ConsumeToken(ctx context.Context, bizType, token string) (bool, error) {
    key := fmt.Sprintf("token:%s:%s", bizType, token)
    
    // 删除并返回是否存在
    result, err := s.redis.Del(ctx, key).Result()
    if err != nil {
        return false, err
    }
    
    return result == 1, nil
}

// 使用示例
func (h *OrderHandler) CreateOrder(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderRequest
    json.NewDecoder(r.Body).Decode(&req)
    
    // 验证并消费 Token
    valid, err := h.tokenService.ConsumeToken(r.Context(), "create_order", req.Token)
    if err != nil || !valid {
        http.Error(w, "Invalid or expired token", http.StatusBadRequest)
        return
    }
    
    // 处理订单创建
    order, err := h.orderService.Create(r.Context(), &req)
    // ...
}
```

### 3. 数据库唯一约束

利用数据库唯一索引保证幂等。

```sql
-- 幂等记录表
CREATE TABLE idempotency_records (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    biz_type VARCHAR(32) NOT NULL,
    biz_id VARCHAR(64),
    status VARCHAR(20) DEFAULT 'processing',
    response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
);

-- 业务表添加唯一约束
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    order_no VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    -- 幂等键：用户ID + 请求ID
    idempotency_key VARCHAR(128),
    UNIQUE INDEX idx_idempotency (idempotency_key)
);
```

```go
// 基于数据库的幂等处理
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderRequest) (*Order, error) {
    idempotencyKey := req.IdempotencyKey
    
    // 1. 检查是否已处理
    var existing IdempotencyRecord
    err := s.db.QueryRowContext(ctx,
        "SELECT biz_id, status, response FROM idempotency_records WHERE idempotency_key = ?",
        idempotencyKey,
    ).Scan(&existing.BizID, &existing.Status, &existing.Response)
    
    if err == nil {
        if existing.Status == "completed" {
            // 已完成，返回缓存结果
            var order Order
            json.Unmarshal([]byte(existing.Response), &order)
            return &order, nil
        }
        // 处理中
        return nil, errors.New("request is being processed")
    }
    
    // 2. 插入幂等记录
    _, err = s.db.ExecContext(ctx,
        "INSERT INTO idempotency_records (idempotency_key, biz_type, status) VALUES (?, ?, ?)",
        idempotencyKey, "create_order", "processing",
    )
    if err != nil {
        // 唯一键冲突，说明并发请求
        return nil, errors.New("duplicate request")
    }
    
    // 3. 执行业务逻辑
    order, err := s.doCreateOrder(ctx, req)
    if err != nil {
        // 失败，删除幂等记录（允许重试）
        s.db.ExecContext(ctx,
            "DELETE FROM idempotency_records WHERE idempotency_key = ?",
            idempotencyKey,
        )
        return nil, err
    }
    
    // 4. 更新幂等记录
    response, _ := json.Marshal(order)
    s.db.ExecContext(ctx,
        "UPDATE idempotency_records SET biz_id = ?, status = ?, response = ? WHERE idempotency_key = ?",
        order.ID, "completed", string(response), idempotencyKey,
    )
    
    return order, nil
}
```

### 4. 状态机

利用状态流转保证幂等。

```go
// 订单状态机
type OrderStateMachine struct {
    transitions map[OrderStatus][]OrderStatus
}

func NewOrderStateMachine() *OrderStateMachine {
    return &OrderStateMachine{
        transitions: map[OrderStatus][]OrderStatus{
            OrderStatusPending:   {OrderStatusPaid, OrderStatusCancelled},
            OrderStatusPaid:      {OrderStatusShipped},
            OrderStatusShipped:   {OrderStatusDelivered},
            OrderStatusDelivered: {},
            OrderStatusCancelled: {},
        },
    }
}

// 幂等的状态转换
func (s *OrderService) PayOrder(ctx context.Context, orderID int64, paymentID string) error {
    return s.db.Transaction(func(tx *sql.Tx) error {
        // 1. 加锁读取订单
        var order Order
        err := tx.QueryRowContext(ctx,
            "SELECT id, status, payment_id FROM orders WHERE id = ? FOR UPDATE",
            orderID,
        ).Scan(&order.ID, &order.Status, &order.PaymentID)
        if err != nil {
            return err
        }
        
        // 2. 幂等检查：已经是目标状态
        if order.Status == OrderStatusPaid {
            if order.PaymentID == paymentID {
                return nil // 幂等，相同支付已处理
            }
            return errors.New("order already paid with different payment")
        }
        
        // 3. 状态机检查
        if !s.stateMachine.CanTransition(order.Status, OrderStatusPaid) {
            return fmt.Errorf("cannot transition from %s to paid", order.Status)
        }
        
        // 4. 更新状态
        _, err = tx.ExecContext(ctx,
            "UPDATE orders SET status = ?, payment_id = ? WHERE id = ? AND status = ?",
            OrderStatusPaid, paymentID, orderID, order.Status,
        )
        return err
    })
}
```

### 5. Redis + Lua 原子操作

```lua
-- 幂等扣减库存
-- KEYS[1]: 库存 key
-- KEYS[2]: 幂等 key
-- ARGV[1]: 扣减数量
-- ARGV[2]: 订单ID
-- ARGV[3]: 过期时间(秒)

local stock_key = KEYS[1]
local idempotent_key = KEYS[2]
local quantity = tonumber(ARGV[1])
local order_id = ARGV[2]
local expire = tonumber(ARGV[3])

-- 幂等检查
local processed = redis.call("GET", idempotent_key)
if processed then
    if processed == order_id then
        return 1  -- 已处理，幂等返回成功
    else
        return -1 -- 幂等键冲突
    end
end

-- 检查库存
local stock = tonumber(redis.call("GET", stock_key) or 0)
if stock < quantity then
    return 0  -- 库存不足
end

-- 扣减库存
redis.call("DECRBY", stock_key, quantity)

-- 记录幂等
redis.call("SETEX", idempotent_key, expire, order_id)

return 1  -- 成功
```

```go
// Go 调用
func (s *StockService) DeductStock(ctx context.Context, productID int64, quantity int, orderID string) error {
    stockKey := fmt.Sprintf("stock:%d", productID)
    idempotentKey := fmt.Sprintf("stock_deduct:%d:%s", productID, orderID)
    
    result, err := s.deductScript.Run(ctx, s.redis,
        []string{stockKey, idempotentKey},
        quantity, orderID, 86400,
    ).Int()
    
    if err != nil {
        return err
    }
    
    switch result {
    case 1:
        return nil
    case 0:
        return errors.New("库存不足")
    case -1:
        return errors.New("幂等键冲突")
    default:
        return errors.New("未知错误")
    }
}
```

## 消息队列幂等

### 消费者幂等

```go
// 幂等消费者
type IdempotentConsumer struct {
    redis   *redis.Client
    handler MessageHandler
    ttl     time.Duration
}

func (c *IdempotentConsumer) Consume(ctx context.Context, msg *Message) error {
    // 生成幂等键
    idempotentKey := fmt.Sprintf("msg_consumed:%s", msg.ID)
    
    // 检查是否已消费
    exists, err := c.redis.Exists(ctx, idempotentKey).Result()
    if err != nil {
        return err
    }
    if exists > 0 {
        log.Info("message already consumed", "msg_id", msg.ID)
        return nil // 幂等返回
    }
    
    // 尝试获取处理锁
    lockKey := idempotentKey + ":lock"
    locked, err := c.redis.SetNX(ctx, lockKey, "1", 60*time.Second).Result()
    if err != nil || !locked {
        return errors.New("message is being processed")
    }
    defer c.redis.Del(ctx, lockKey)
    
    // 处理消息
    if err := c.handler.Handle(ctx, msg); err != nil {
        return err
    }
    
    // 标记已消费
    c.redis.Set(ctx, idempotentKey, "1", c.ttl)
    
    return nil
}
```

### 生产者幂等

```go
// 幂等生产者（防止重复发送）
type IdempotentProducer struct {
    mq    MessageQueue
    redis *redis.Client
}

func (p *IdempotentProducer) Send(ctx context.Context, topic string, msg *Message) error {
    // 使用业务 ID 作为幂等键
    idempotentKey := fmt.Sprintf("msg_sent:%s:%s", topic, msg.BizID)
    
    // 检查是否已发送
    msgID, err := p.redis.Get(ctx, idempotentKey).Result()
    if err == nil {
        msg.ID = msgID // 使用已发送的消息 ID
        return nil
    }
    
    // 发送消息
    msg.ID = uuid.New().String()
    if err := p.mq.Send(ctx, topic, msg); err != nil {
        return err
    }
    
    // 记录已发送
    p.redis.Set(ctx, idempotentKey, msg.ID, 24*time.Hour)
    
    return nil
}
```

## 幂等性测试

```go
func TestIdempotency(t *testing.T) {
    service := NewOrderService(db, redis)
    
    req := &CreateOrderRequest{
        UserID:         1,
        ProductID:      100,
        Quantity:       1,
        IdempotencyKey: "test-key-001",
    }
    
    // 第一次请求
    order1, err := service.CreateOrder(context.Background(), req)
    assert.NoError(t, err)
    assert.NotNil(t, order1)
    
    // 第二次相同请求（幂等）
    order2, err := service.CreateOrder(context.Background(), req)
    assert.NoError(t, err)
    assert.Equal(t, order1.ID, order2.ID) // 返回相同订单
    
    // 验证只创建了一个订单
    count := countOrders(db, req.UserID)
    assert.Equal(t, 1, count)
}

func TestConcurrentIdempotency(t *testing.T) {
    service := NewOrderService(db, redis)
    
    req := &CreateOrderRequest{
        UserID:         1,
        ProductID:      100,
        Quantity:       1,
        IdempotencyKey: "concurrent-test-001",
    }
    
    // 并发请求
    var wg sync.WaitGroup
    results := make(chan *Order, 10)
    errors := make(chan error, 10)
    
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            order, err := service.CreateOrder(context.Background(), req)
            if err != nil {
                errors <- err
            } else {
                results <- order
            }
        }()
    }
    
    wg.Wait()
    close(results)
    close(errors)
    
    // 验证结果
    var orders []*Order
    for order := range results {
        orders = append(orders, order)
    }
    
    // 所有成功的请求应该返回相同订单
    if len(orders) > 0 {
        firstID := orders[0].ID
        for _, order := range orders {
            assert.Equal(t, firstID, order.ID)
        }
    }
    
    // 验证只创建了一个订单
    count := countOrders(db, req.UserID)
    assert.Equal(t, 1, count)
}
```

## 最佳实践

### 1. 幂等键设计

```go
// 好的幂等键设计
idempotencyKey := fmt.Sprintf("%s:%s:%s", bizType, userID, requestID)
// 例如: "create_order:user_123:req_abc123"

// 避免使用时间戳
// 错误: "create_order:user_123:1704067200" // 可能重复
```

### 2. 幂等键过期时间

```go
// 根据业务场景设置
// 支付类：24小时（防止重复支付）
// 下单类：10分钟（用户可能重新下单）
// 消息消费：7天（消息可能延迟重投）
```

### 3. 失败处理

```go
func (s *Service) Process(ctx context.Context, req *Request) error {
    // 记录开始处理
    if err := s.markProcessing(ctx, req.IdempotencyKey); err != nil {
        return err
    }
    
    // 执行业务
    result, err := s.doProcess(ctx, req)
    
    if err != nil {
        // 业务失败，清除幂等记录，允许重试
        s.clearIdempotency(ctx, req.IdempotencyKey)
        return err
    }
    
    // 成功，记录结果
    s.markCompleted(ctx, req.IdempotencyKey, result)
    return nil
}
```

### 4. 监控告警

```go
// 幂等命中率监控
var (
    idempotencyHits = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "idempotency_hits_total",
            Help: "Total idempotency cache hits",
        },
        []string{"biz_type"},
    )
    
    idempotencyMisses = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "idempotency_misses_total",
            Help: "Total idempotency cache misses",
        },
        []string{"biz_type"},
    )
)

// 高命中率可能意味着：
// 1. 客户端重试过多
// 2. 网络问题导致重复请求
// 3. 需要优化客户端逻辑
```

## 总结

幂等性设计的核心要点：

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| 唯一请求 ID | 通用、灵活 | 需要客户端配合 | API 接口 |
| Token 机制 | 安全、可控 | 多一次请求 | 表单提交 |
| 数据库唯一约束 | 强一致 | 性能较低 | 关键业务 |
| 状态机 | 业务语义清晰 | 仅适用状态流转 | 订单/工单 |
| Redis + Lua | 高性能 | 需要处理 Redis 故障 | 高并发场景 |

核心原则：
1. **先查后做** - 处理前检查是否已处理
2. **原子操作** - 检查和处理要原子化
3. **唯一标识** - 使用业务唯一键而非请求 ID
4. **合理过期** - 根据业务设置幂等记录过期时间
5. **失败可重试** - 业务失败时清除幂等记录

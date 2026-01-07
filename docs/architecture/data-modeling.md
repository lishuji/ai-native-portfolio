---
sidebar_position: 4
---

# 数据建模实践

数据模型是系统的基石。好的数据模型能让业务逻辑清晰、查询高效、扩展灵活。本文将分享数据建模的原则、模式和实战经验。

## 建模原则

### 1. 业务驱动

数据模型应该反映业务领域，而非技术实现。

```
❌ 错误：按技术分表
   - data_table_1
   - data_table_2
   - config_json

✅ 正确：按业务领域建模
   - users (用户)
   - orders (订单)
   - products (商品)
   - payments (支付)
```

### 2. 适度冗余

在读多写少的场景，适当冗余可以避免 JOIN，提升查询性能。

```sql
-- 订单表冗余用户名和商品名
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    user_name VARCHAR(64),      -- 冗余字段
    product_id BIGINT NOT NULL,
    product_name VARCHAR(128),  -- 冗余字段
    amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 查询时无需 JOIN
SELECT id, user_name, product_name, amount 
FROM orders 
WHERE user_id = 123;
```

### 3. 预留扩展

为未来变化预留空间。

```sql
-- 使用 JSON 字段存储扩展属性
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    category VARCHAR(32),
    -- 扩展属性，不同品类有不同字段
    attributes JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 电子产品
INSERT INTO products (name, price, category, attributes) VALUES 
('iPhone 15', 7999.00, 'electronics', '{"brand": "Apple", "storage": "256GB", "color": "black"}');

-- 服装
INSERT INTO products (name, price, category, attributes) VALUES 
('T-Shirt', 99.00, 'clothing', '{"size": "L", "material": "cotton", "color": "white"}');
```

## 常见建模模式

### 1. 主从表模式

一对多关系的经典模式。

```sql
-- 订单主表
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_status_created (status, created_at)
);

-- 订单明细表
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    INDEX idx_order_id (order_id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);
```

```go
// Go 模型定义
type Order struct {
    ID          int64       `json:"id" db:"id"`
    UserID      int64       `json:"user_id" db:"user_id"`
    TotalAmount float64     `json:"total_amount" db:"total_amount"`
    Status      string      `json:"status" db:"status"`
    Items       []OrderItem `json:"items" db:"-"` // 关联加载
    CreatedAt   time.Time   `json:"created_at" db:"created_at"`
}

type OrderItem struct {
    ID        int64   `json:"id" db:"id"`
    OrderID   int64   `json:"order_id" db:"order_id"`
    ProductID int64   `json:"product_id" db:"product_id"`
    Quantity  int     `json:"quantity" db:"quantity"`
    UnitPrice float64 `json:"unit_price" db:"unit_price"`
    Subtotal  float64 `json:"subtotal" db:"subtotal"`
}
```

### 2. 状态机模式

用于有明确状态流转的业务。

```sql
-- 订单状态表
CREATE TABLE order_status_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    operator_id BIGINT,
    reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_id (order_id)
);
```

```go
// 状态机定义
type OrderStatus string

const (
    OrderStatusPending   OrderStatus = "pending"
    OrderStatusPaid      OrderStatus = "paid"
    OrderStatusShipped   OrderStatus = "shipped"
    OrderStatusDelivered OrderStatus = "delivered"
    OrderStatusCancelled OrderStatus = "cancelled"
    OrderStatusRefunded  OrderStatus = "refunded"
)

// 状态转换规则
var orderTransitions = map[OrderStatus][]OrderStatus{
    OrderStatusPending:   {OrderStatusPaid, OrderStatusCancelled},
    OrderStatusPaid:      {OrderStatusShipped, OrderStatusRefunded},
    OrderStatusShipped:   {OrderStatusDelivered, OrderStatusRefunded},
    OrderStatusDelivered: {OrderStatusRefunded},
    OrderStatusCancelled: {},
    OrderStatusRefunded:  {},
}

func (o *Order) CanTransitionTo(newStatus OrderStatus) bool {
    allowed, ok := orderTransitions[o.Status]
    if !ok {
        return false
    }
    for _, s := range allowed {
        if s == newStatus {
            return true
        }
    }
    return false
}

func (o *Order) TransitionTo(newStatus OrderStatus, operatorID int64, reason string) error {
    if !o.CanTransitionTo(newStatus) {
        return fmt.Errorf("invalid transition from %s to %s", o.Status, newStatus)
    }
    
    oldStatus := o.Status
    o.Status = newStatus
    
    // 记录状态变更日志
    log := &OrderStatusLog{
        OrderID:    o.ID,
        FromStatus: oldStatus,
        ToStatus:   newStatus,
        OperatorID: operatorID,
        Reason:     reason,
    }
    
    return o.repo.SaveWithLog(o, log)
}
```

### 3. 快照模式

保存历史状态，用于审计和回溯。

```sql
-- 商品快照表（订单创建时保存）
CREATE TABLE product_snapshots (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    name VARCHAR(128) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    attributes JSON,
    snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_product_id (product_id)
);

-- 订单关联商品快照
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_snapshot_id BIGINT NOT NULL,  -- 关联快照而非原商品
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (product_snapshot_id) REFERENCES product_snapshots(id)
);
```

```go
// 创建订单时保存商品快照
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) (*Order, error) {
    var items []OrderItem
    var totalAmount float64
    
    for _, item := range req.Items {
        product, err := s.productRepo.GetByID(ctx, item.ProductID)
        if err != nil {
            return nil, err
        }
        
        // 创建商品快照
        snapshot := &ProductSnapshot{
            ProductID:   product.ID,
            Name:        product.Name,
            Price:       product.Price,
            Description: product.Description,
            Attributes:  product.Attributes,
        }
        if err := s.snapshotRepo.Create(ctx, snapshot); err != nil {
            return nil, err
        }
        
        subtotal := product.Price * float64(item.Quantity)
        items = append(items, OrderItem{
            ProductSnapshotID: snapshot.ID,
            Quantity:          item.Quantity,
            UnitPrice:         product.Price,
            Subtotal:          subtotal,
        })
        totalAmount += subtotal
    }
    
    order := &Order{
        UserID:      req.UserID,
        TotalAmount: totalAmount,
        Items:       items,
    }
    
    return s.orderRepo.Create(ctx, order)
}
```

### 4. 软删除模式

逻辑删除而非物理删除。

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    email VARCHAR(128) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    deleted_at TIMESTAMP NULL,  -- NULL 表示未删除
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 唯一索引需要考虑软删除
    UNIQUE INDEX idx_username_deleted (username, deleted_at),
    UNIQUE INDEX idx_email_deleted (email, deleted_at)
);
```

```go
// GORM 软删除
type User struct {
    ID        int64          `gorm:"primaryKey"`
    Username  string         `gorm:"uniqueIndex:idx_username_deleted"`
    Email     string         `gorm:"uniqueIndex:idx_email_deleted"`
    Status    string         `gorm:"default:active"`
    DeletedAt gorm.DeletedAt `gorm:"index"` // 软删除字段
    CreatedAt time.Time
    UpdatedAt time.Time
}

// 查询自动过滤已删除记录
db.Find(&users) // WHERE deleted_at IS NULL

// 包含已删除记录
db.Unscoped().Find(&users)

// 软删除
db.Delete(&user) // UPDATE users SET deleted_at = NOW() WHERE id = ?

// 物理删除
db.Unscoped().Delete(&user) // DELETE FROM users WHERE id = ?
```

### 5. 多态关联模式

一个表关联多种类型的实体。

```sql
-- 评论表（可以评论商品、文章、视频等）
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    -- 多态关联
    target_type VARCHAR(32) NOT NULL,  -- 'product', 'article', 'video'
    target_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id),
    INDEX idx_user_id (user_id)
);

-- 操作日志表
CREATE TABLE activity_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    action VARCHAR(32) NOT NULL,  -- 'create', 'update', 'delete'
    target_type VARCHAR(32) NOT NULL,
    target_id BIGINT NOT NULL,
    changes JSON,  -- 变更内容
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id),
    INDEX idx_user_created (user_id, created_at)
);
```

```go
// 多态关联接口
type Commentable interface {
    GetTargetType() string
    GetTargetID() int64
}

type Comment struct {
    ID         int64     `json:"id"`
    UserID     int64     `json:"user_id"`
    Content    string    `json:"content"`
    TargetType string    `json:"target_type"`
    TargetID   int64     `json:"target_id"`
    CreatedAt  time.Time `json:"created_at"`
}

func (s *CommentService) Create(ctx context.Context, userID int64, target Commentable, content string) (*Comment, error) {
    comment := &Comment{
        UserID:     userID,
        Content:    content,
        TargetType: target.GetTargetType(),
        TargetID:   target.GetTargetID(),
    }
    return s.repo.Create(ctx, comment)
}

// Product 实现 Commentable
func (p *Product) GetTargetType() string { return "product" }
func (p *Product) GetTargetID() int64    { return p.ID }
```

## 索引设计

### 索引原则

1. **选择性高的列优先** - 区分度越高越好
2. **最左前缀原则** - 复合索引按查询条件顺序设计
3. **覆盖索引** - 索引包含查询所需所有列
4. **避免过多索引** - 影响写入性能

### 常见索引模式

```sql
-- 1. 单列索引
CREATE INDEX idx_user_id ON orders(user_id);

-- 2. 复合索引（注意顺序）
-- 查询: WHERE status = 'paid' AND created_at > '2025-01-01'
CREATE INDEX idx_status_created ON orders(status, created_at);

-- 3. 覆盖索引
-- 查询: SELECT id, status, amount FROM orders WHERE user_id = ?
CREATE INDEX idx_user_covering ON orders(user_id, status, amount);

-- 4. 前缀索引（长字符串）
CREATE INDEX idx_email_prefix ON users(email(20));

-- 5. 唯一索引
CREATE UNIQUE INDEX idx_username ON users(username);
```

### 索引优化案例

```sql
-- 原始查询（全表扫描）
EXPLAIN SELECT * FROM orders 
WHERE user_id = 123 
  AND status = 'paid' 
  AND created_at > '2025-01-01'
ORDER BY created_at DESC 
LIMIT 10;

-- 优化：创建复合索引
CREATE INDEX idx_user_status_created ON orders(user_id, status, created_at);

-- 优化后（索引范围扫描）
-- type: range, key: idx_user_status_created
```

## 分库分表设计

### 分片策略

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| 范围分片 | 扩容简单 | 热点问题 | 时间序列数据 |
| 哈希分片 | 数据均匀 | 扩容复杂 | 用户数据 |
| 一致性哈希 | 扩容平滑 | 实现复杂 | 分布式缓存 |

### 分表实现

```go
// 分表路由
type ShardRouter struct {
    shardCount int
    tablePrefix string
}

func NewShardRouter(prefix string, count int) *ShardRouter {
    return &ShardRouter{
        shardCount:  count,
        tablePrefix: prefix,
    }
}

// 按用户 ID 分表
func (r *ShardRouter) GetTable(userID int64) string {
    shard := userID % int64(r.shardCount)
    return fmt.Sprintf("%s_%d", r.tablePrefix, shard)
}

// 分表仓储
type ShardedOrderRepo struct {
    db     *sql.DB
    router *ShardRouter
}

func (r *ShardedOrderRepo) GetByID(ctx context.Context, userID, orderID int64) (*Order, error) {
    table := r.router.GetTable(userID)
    query := fmt.Sprintf("SELECT * FROM %s WHERE id = ? AND user_id = ?", table)
    
    var order Order
    err := r.db.QueryRowContext(ctx, query, orderID, userID).Scan(
        &order.ID, &order.UserID, &order.TotalAmount, &order.Status, &order.CreatedAt,
    )
    return &order, err
}

func (r *ShardedOrderRepo) Create(ctx context.Context, order *Order) error {
    table := r.router.GetTable(order.UserID)
    query := fmt.Sprintf(
        "INSERT INTO %s (id, user_id, total_amount, status) VALUES (?, ?, ?, ?)",
        table,
    )
    _, err := r.db.ExecContext(ctx, query, order.ID, order.UserID, order.TotalAmount, order.Status)
    return err
}
```

### 全局 ID 生成

```go
// Snowflake ID 生成器
type Snowflake struct {
    mu        sync.Mutex
    epoch     int64 // 起始时间戳
    nodeID    int64 // 节点 ID
    sequence  int64 // 序列号
    lastTime  int64
}

func NewSnowflake(nodeID int64) *Snowflake {
    return &Snowflake{
        epoch:  1704067200000, // 2024-01-01 00:00:00 UTC
        nodeID: nodeID,
    }
}

func (s *Snowflake) Generate() int64 {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    now := time.Now().UnixMilli()
    
    if now == s.lastTime {
        s.sequence = (s.sequence + 1) & 0xFFF // 12 bit sequence
        if s.sequence == 0 {
            // 等待下一毫秒
            for now <= s.lastTime {
                now = time.Now().UnixMilli()
            }
        }
    } else {
        s.sequence = 0
    }
    
    s.lastTime = now
    
    // 41 bit timestamp + 10 bit node + 12 bit sequence
    id := ((now - s.epoch) << 22) | (s.nodeID << 12) | s.sequence
    return id
}
```

## 数据迁移

### 在线迁移方案

```go
// 双写迁移
type MigrationOrderRepo struct {
    oldRepo *OldOrderRepo
    newRepo *NewOrderRepo
    phase   MigrationPhase
}

type MigrationPhase int

const (
    PhaseOldOnly    MigrationPhase = iota // 只写旧库
    PhaseDualWrite                         // 双写
    PhaseNewPrimary                        // 新库为主，旧库为备
    PhaseNewOnly                           // 只写新库
)

func (r *MigrationOrderRepo) Create(ctx context.Context, order *Order) error {
    switch r.phase {
    case PhaseOldOnly:
        return r.oldRepo.Create(ctx, order)
        
    case PhaseDualWrite:
        // 双写，旧库为主
        if err := r.oldRepo.Create(ctx, order); err != nil {
            return err
        }
        // 异步写新库
        go r.newRepo.Create(context.Background(), order)
        return nil
        
    case PhaseNewPrimary:
        // 双写，新库为主
        if err := r.newRepo.Create(ctx, order); err != nil {
            return err
        }
        go r.oldRepo.Create(context.Background(), order)
        return nil
        
    case PhaseNewOnly:
        return r.newRepo.Create(ctx, order)
    }
    return nil
}

func (r *MigrationOrderRepo) GetByID(ctx context.Context, id int64) (*Order, error) {
    switch r.phase {
    case PhaseOldOnly, PhaseDualWrite:
        return r.oldRepo.GetByID(ctx, id)
    case PhaseNewPrimary, PhaseNewOnly:
        order, err := r.newRepo.GetByID(ctx, id)
        if err != nil && r.phase == PhaseNewPrimary {
            // 降级到旧库
            return r.oldRepo.GetByID(ctx, id)
        }
        return order, err
    }
    return nil, errors.New("unknown phase")
}
```

## 总结

数据建模的核心要点：

1. **业务驱动** - 模型反映业务领域，而非技术实现
2. **适度冗余** - 读多写少场景，冗余换性能
3. **状态机** - 明确状态流转，记录变更日志
4. **快照模式** - 保存历史状态，支持审计回溯
5. **索引优化** - 选择性、最左前缀、覆盖索引
6. **分库分表** - 哈希分片、全局 ID、平滑迁移

好的数据模型是系统稳定性和可维护性的基础。

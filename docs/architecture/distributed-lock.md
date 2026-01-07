---
sidebar_position: 2
---

# 分布式锁实战

在分布式系统中，多个节点可能同时操作共享资源，需要分布式锁来保证数据一致性。本文将深入探讨分布式锁的实现方案、常见陷阱和最佳实践。

## 为什么需要分布式锁

```
                    ┌─────────────┐
                    │   共享资源   │
                    │  (库存/余额) │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
   │ 节点 A  │        │ 节点 B  │        │ 节点 C  │
   │ 扣减库存 │        │ 扣减库存 │        │ 扣减库存 │
   └─────────┘        └─────────┘        └─────────┘
   
   问题：库存=10，A/B/C 同时读取，各扣减5，最终库存=-5
   解决：分布式锁保证同一时刻只有一个节点操作
```

### 典型场景

- **库存扣减** - 防止超卖
- **订单创建** - 防止重复下单
- **定时任务** - 防止多节点重复执行
- **限流控制** - 分布式限流计数

## Redis 分布式锁

### 基础实现

```go
// Redis 分布式锁
type RedisLock struct {
    client     *redis.Client
    key        string
    value      string // 唯一标识，用于安全释放
    expiration time.Duration
}

func NewRedisLock(client *redis.Client, key string, expiration time.Duration) *RedisLock {
    return &RedisLock{
        client:     client,
        key:        "lock:" + key,
        value:      uuid.New().String(), // 每个锁实例唯一
        expiration: expiration,
    }
}

// 加锁
func (l *RedisLock) Lock(ctx context.Context) (bool, error) {
    // SET key value NX PX milliseconds
    ok, err := l.client.SetNX(ctx, l.key, l.value, l.expiration).Result()
    return ok, err
}

// 解锁 - 必须使用 Lua 脚本保证原子性
func (l *RedisLock) Unlock(ctx context.Context) error {
    script := `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
    `
    _, err := l.client.Eval(ctx, script, []string{l.key}, l.value).Result()
    return err
}
```

### 为什么解锁需要 Lua 脚本？

```
时间线:
T1: 客户端A 获取锁，value=A
T2: 客户端A 业务处理中...
T3: 锁过期，自动释放
T4: 客户端B 获取锁，value=B
T5: 客户端A 业务完成，尝试释放锁
    - 错误做法：直接 DEL key → 删除了 B 的锁！
    - 正确做法：先 GET 判断 value==A，再 DEL → 不会误删
    - 问题：GET 和 DEL 非原子，可能在中间被 B 获取锁
    - 解决：Lua 脚本保证原子性
```

### 可重入锁

```go
// 可重入锁实现
type ReentrantLock struct {
    client     *redis.Client
    key        string
    value      string
    expiration time.Duration
}

// Lua 脚本：可重入加锁
var lockScript = redis.NewScript(`
    local key = KEYS[1]
    local value = ARGV[1]
    local ttl = tonumber(ARGV[2])
    
    -- 检查锁是否存在
    local current = redis.call("GET", key)
    
    if current == false then
        -- 锁不存在，设置锁和计数器
        redis.call("SET", key, value, "PX", ttl)
        redis.call("SET", key..":count", 1, "PX", ttl)
        return 1
    elseif current == value then
        -- 同一持有者，增加计数
        redis.call("INCR", key..":count")
        redis.call("PEXPIRE", key, ttl)
        redis.call("PEXPIRE", key..":count", ttl)
        return 1
    else
        -- 其他持有者
        return 0
    end
`)

// Lua 脚本：可重入解锁
var unlockScript = redis.NewScript(`
    local key = KEYS[1]
    local value = ARGV[1]
    
    local current = redis.call("GET", key)
    if current ~= value then
        return 0
    end
    
    local count = redis.call("DECR", key..":count")
    if count <= 0 then
        redis.call("DEL", key)
        redis.call("DEL", key..":count")
    end
    return 1
`)

func (l *ReentrantLock) Lock(ctx context.Context) (bool, error) {
    result, err := lockScript.Run(ctx, l.client, []string{l.key}, l.value, l.expiration.Milliseconds()).Int()
    return result == 1, err
}

func (l *ReentrantLock) Unlock(ctx context.Context) error {
    _, err := unlockScript.Run(ctx, l.client, []string{l.key}, l.value).Result()
    return err
}
```

### 自动续期（看门狗）

```go
// 带自动续期的分布式锁
type WatchdogLock struct {
    client     *redis.Client
    key        string
    value      string
    expiration time.Duration
    stopCh     chan struct{}
    stopped    int32
}

func (l *WatchdogLock) Lock(ctx context.Context) (bool, error) {
    ok, err := l.client.SetNX(ctx, l.key, l.value, l.expiration).Result()
    if err != nil || !ok {
        return ok, err
    }
    
    // 启动看门狗协程
    l.stopCh = make(chan struct{})
    go l.watchdog()
    
    return true, nil
}

func (l *WatchdogLock) watchdog() {
    ticker := time.NewTicker(l.expiration / 3) // 每 1/3 过期时间续期一次
    defer ticker.Stop()
    
    for {
        select {
        case <-l.stopCh:
            return
        case <-ticker.C:
            if atomic.LoadInt32(&l.stopped) == 1 {
                return
            }
            // 续期
            l.client.Expire(context.Background(), l.key, l.expiration)
        }
    }
}

func (l *WatchdogLock) Unlock(ctx context.Context) error {
    atomic.StoreInt32(&l.stopped, 1)
    close(l.stopCh)
    
    script := `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
    `
    _, err := l.client.Eval(ctx, script, []string{l.key}, l.value).Result()
    return err
}
```

### RedLock 算法

单 Redis 节点存在单点故障风险。RedLock 使用多个独立 Redis 节点提高可靠性。

```go
// RedLock 实现
type RedLock struct {
    clients    []*redis.Client
    key        string
    value      string
    expiration time.Duration
    quorum     int // 多数派数量
}

func NewRedLock(clients []*redis.Client, key string, expiration time.Duration) *RedLock {
    return &RedLock{
        clients:    clients,
        key:        "lock:" + key,
        value:      uuid.New().String(),
        expiration: expiration,
        quorum:     len(clients)/2 + 1,
    }
}

func (l *RedLock) Lock(ctx context.Context) (bool, error) {
    start := time.Now()
    successCount := 0
    
    // 尝试在所有节点加锁
    for _, client := range l.clients {
        ok, err := client.SetNX(ctx, l.key, l.value, l.expiration).Result()
        if err == nil && ok {
            successCount++
        }
    }
    
    // 计算获取锁消耗的时间
    elapsed := time.Since(start)
    
    // 判断是否成功：多数派成功 且 剩余有效期足够
    validityTime := l.expiration - elapsed
    if successCount >= l.quorum && validityTime > 0 {
        return true, nil
    }
    
    // 获取失败，释放已获取的锁
    l.Unlock(ctx)
    return false, nil
}

func (l *RedLock) Unlock(ctx context.Context) error {
    script := `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
    `
    
    for _, client := range l.clients {
        client.Eval(ctx, script, []string{l.key}, l.value)
    }
    return nil
}
```

## 数据库分布式锁

### 基于唯一索引

```sql
-- 锁表
CREATE TABLE distributed_locks (
    lock_key VARCHAR(128) PRIMARY KEY,
    lock_value VARCHAR(64) NOT NULL,
    expire_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建过期索引，用于清理
CREATE INDEX idx_expire_at ON distributed_locks(expire_at);
```

```go
// 数据库分布式锁
type DBLock struct {
    db         *sql.DB
    key        string
    value      string
    expiration time.Duration
}

func (l *DBLock) Lock(ctx context.Context) (bool, error) {
    expireAt := time.Now().Add(l.expiration)
    
    // 先尝试清理过期锁
    l.db.ExecContext(ctx, 
        "DELETE FROM distributed_locks WHERE lock_key = ? AND expire_at < ?",
        l.key, time.Now(),
    )
    
    // 尝试插入锁记录
    _, err := l.db.ExecContext(ctx,
        "INSERT INTO distributed_locks (lock_key, lock_value, expire_at) VALUES (?, ?, ?)",
        l.key, l.value, expireAt,
    )
    
    if err != nil {
        // 唯一索引冲突，锁已被占用
        return false, nil
    }
    return true, nil
}

func (l *DBLock) Unlock(ctx context.Context) error {
    _, err := l.db.ExecContext(ctx,
        "DELETE FROM distributed_locks WHERE lock_key = ? AND lock_value = ?",
        l.key, l.value,
    )
    return err
}
```

### 基于悲观锁

```go
// 使用 SELECT FOR UPDATE
func (s *StockService) DeductWithLock(ctx context.Context, productID int64, quantity int) error {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()
    
    // 悲观锁：锁定行
    var stock int
    err = tx.QueryRowContext(ctx,
        "SELECT stock FROM products WHERE id = ? FOR UPDATE",
        productID,
    ).Scan(&stock)
    if err != nil {
        return err
    }
    
    if stock < quantity {
        return errors.New("库存不足")
    }
    
    // 扣减库存
    _, err = tx.ExecContext(ctx,
        "UPDATE products SET stock = stock - ? WHERE id = ?",
        quantity, productID,
    )
    if err != nil {
        return err
    }
    
    return tx.Commit()
}
```

### 基于乐观锁

```go
// 使用版本号
func (s *StockService) DeductWithOptimisticLock(ctx context.Context, productID int64, quantity int) error {
    for retries := 0; retries < 3; retries++ {
        // 读取当前库存和版本
        var stock, version int
        err := s.db.QueryRowContext(ctx,
            "SELECT stock, version FROM products WHERE id = ?",
            productID,
        ).Scan(&stock, &version)
        if err != nil {
            return err
        }
        
        if stock < quantity {
            return errors.New("库存不足")
        }
        
        // CAS 更新
        result, err := s.db.ExecContext(ctx,
            "UPDATE products SET stock = stock - ?, version = version + 1 WHERE id = ? AND version = ?",
            quantity, productID, version,
        )
        if err != nil {
            return err
        }
        
        affected, _ := result.RowsAffected()
        if affected == 1 {
            return nil // 成功
        }
        
        // 版本冲突，重试
        time.Sleep(time.Millisecond * 10 * time.Duration(retries+1))
    }
    
    return errors.New("更新失败，请重试")
}
```

## etcd 分布式锁

etcd 基于 Raft 协议，提供强一致性保证。

```go
import (
    clientv3 "go.etcd.io/etcd/client/v3"
    "go.etcd.io/etcd/client/v3/concurrency"
)

// etcd 分布式锁
type EtcdLock struct {
    client  *clientv3.Client
    session *concurrency.Session
    mutex   *concurrency.Mutex
    key     string
}

func NewEtcdLock(client *clientv3.Client, key string, ttl int) (*EtcdLock, error) {
    session, err := concurrency.NewSession(client, concurrency.WithTTL(ttl))
    if err != nil {
        return nil, err
    }
    
    mutex := concurrency.NewMutex(session, "/locks/"+key)
    
    return &EtcdLock{
        client:  client,
        session: session,
        mutex:   mutex,
        key:     key,
    }, nil
}

func (l *EtcdLock) Lock(ctx context.Context) error {
    return l.mutex.Lock(ctx)
}

func (l *EtcdLock) TryLock(ctx context.Context) error {
    return l.mutex.TryLock(ctx)
}

func (l *EtcdLock) Unlock(ctx context.Context) error {
    return l.mutex.Unlock(ctx)
}

func (l *EtcdLock) Close() error {
    return l.session.Close()
}
```

## 方案对比

| 方案 | 性能 | 可靠性 | 复杂度 | 适用场景 |
|------|------|--------|--------|----------|
| Redis 单节点 | 高 | 中 | 低 | 一般场景 |
| RedLock | 中 | 高 | 高 | 高可靠要求 |
| 数据库锁 | 低 | 高 | 低 | 已有数据库 |
| etcd | 中 | 高 | 中 | 强一致性要求 |
| ZooKeeper | 中 | 高 | 高 | 已有 ZK 集群 |

## 常见陷阱

### 1. 锁过期但业务未完成

```go
// 问题：锁过期，其他节点获取锁，导致并发问题
func (s *Service) Process(ctx context.Context) error {
    lock := NewRedisLock(s.redis, "my-lock", 10*time.Second)
    
    ok, _ := lock.Lock(ctx)
    if !ok {
        return errors.New("获取锁失败")
    }
    defer lock.Unlock(ctx)
    
    // 业务处理超过 10 秒...
    time.Sleep(15 * time.Second) // 锁已过期！
    
    return nil
}

// 解决：使用看门狗自动续期
```

### 2. 释放了别人的锁

```go
// 问题：没有验证锁持有者
func (l *BadLock) Unlock(ctx context.Context) error {
    return l.client.Del(ctx, l.key).Err() // 直接删除，可能删除别人的锁
}

// 解决：使用 Lua 脚本验证 value
```

### 3. 锁不可重入导致死锁

```go
// 问题：同一协程重复获取锁
func (s *Service) A(ctx context.Context) error {
    lock.Lock(ctx)
    defer lock.Unlock(ctx)
    
    return s.B(ctx) // B 也需要同一把锁，死锁！
}

func (s *Service) B(ctx context.Context) error {
    lock.Lock(ctx) // 永远无法获取
    defer lock.Unlock(ctx)
    return nil
}

// 解决：使用可重入锁
```

### 4. 集群脑裂

```
主节点: 持有锁
       ↓ 网络分区
从节点: 提升为主，锁丢失
       ↓
新客户端: 获取锁成功
       ↓
两个客户端同时持有锁！
```

解决方案：
- 使用 RedLock 多节点
- 使用 etcd/ZooKeeper 强一致性存储

## 最佳实践

### 1. 锁粒度

```go
// 粗粒度锁（不推荐）
lock := NewLock("order")

// 细粒度锁（推荐）
lock := NewLock(fmt.Sprintf("order:%d", orderID))
```

### 2. 锁超时设置

```go
// 根据业务耗时设置合理的超时
// 太短：业务未完成锁就过期
// 太长：故障时锁长时间无法释放

// 推荐：业务最大耗时的 2-3 倍，配合看门狗续期
lock := NewWatchdogLock(client, key, 30*time.Second)
```

### 3. 获取锁失败的处理

```go
func (s *Service) ProcessWithRetry(ctx context.Context) error {
    lock := NewRedisLock(s.redis, "my-lock", 30*time.Second)
    
    // 带退避的重试
    backoff := time.Millisecond * 100
    for i := 0; i < 5; i++ {
        ok, err := lock.Lock(ctx)
        if err != nil {
            return err
        }
        if ok {
            defer lock.Unlock(ctx)
            return s.doProcess(ctx)
        }
        
        // 退避等待
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
            backoff *= 2 // 指数退避
        }
    }
    
    return errors.New("获取锁超时")
}
```

### 4. 封装统一接口

```go
// 统一锁接口
type DistributedLock interface {
    Lock(ctx context.Context) (bool, error)
    TryLock(ctx context.Context, timeout time.Duration) (bool, error)
    Unlock(ctx context.Context) error
}

// 使用装饰器添加监控
type MonitoredLock struct {
    lock    DistributedLock
    name    string
    metrics *LockMetrics
}

func (l *MonitoredLock) Lock(ctx context.Context) (bool, error) {
    start := time.Now()
    ok, err := l.lock.Lock(ctx)
    
    l.metrics.LockAttempts.WithLabelValues(l.name).Inc()
    l.metrics.LockDuration.WithLabelValues(l.name).Observe(time.Since(start).Seconds())
    
    if ok {
        l.metrics.LockAcquired.WithLabelValues(l.name).Inc()
    } else {
        l.metrics.LockFailed.WithLabelValues(l.name).Inc()
    }
    
    return ok, err
}
```

## 总结

分布式锁的核心要点：

1. **原子性** - 加锁、解锁操作必须原子
2. **唯一标识** - 只有锁持有者才能释放锁
3. **过期机制** - 防止死锁，但要配合续期
4. **可重入** - 同一持有者可多次获取
5. **高可用** - RedLock 或强一致性存储

选择建议：
- 一般场景：Redis 单节点 + 看门狗
- 高可靠：RedLock 或 etcd
- 强一致：etcd 或 ZooKeeper

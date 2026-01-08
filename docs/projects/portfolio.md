---
sidebar_position: 1
---

# 项目作品集

这里展示我在后端开发和 AI 工程领域的核心项目，涵盖高并发系统、分布式架构、AI Agent 等技术方向。

---

## 🏢 企业级项目

### 1. 电商高并发订单系统

**项目背景**：支撑千万级用户的电商平台核心交易系统

**技术架构**：
```
┌─────────────────────────────────────────────────────────────┐
│                    订单系统架构图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户请求 ──▶ 网关 ──▶ 订单服务 ──▶ 库存服务                │
│              │         │           │                        │
│              │         ▼           ▼                        │
│              │      Redis缓存   消息队列                     │
│              │         │           │                        │
│              ▼         ▼           ▼                        │
│           限流组件   订单数据库   异步处理                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心技术**：
- **语言**：Go + Gin 框架
- **数据库**：MySQL 主从 + Redis 集群 + MongoDB
- **消息队列**：Kafka + RocketMQ
- **缓存策略**：多级缓存 + 缓存预热
- **限流熔断**：令牌桶 + 滑动窗口

**关键实现**：

```go
// 库存扣减 - Redis Lua 原子操作
const stockDeductScript = `
    local stock_key = KEYS[1]
    local deduct_num = tonumber(ARGV[1])
    local current_stock = tonumber(redis.call('get', stock_key) or 0)
    
    if current_stock >= deduct_num then
        redis.call('decrby', stock_key, deduct_num)
        return current_stock - deduct_num
    else
        return -1
    end
`

func (s *StockService) DeductStock(ctx context.Context, sku string, num int) error {
    result, err := s.redis.Eval(ctx, stockDeductScript, []string{
        fmt.Sprintf("stock:%s", sku),
    }, num).Result()
    
    if err != nil {
        return err
    }
    
    if result.(int64) < 0 {
        return errors.New("库存不足")
    }
    
    return nil
}
```

**性能指标**：
- **QPS**：峰值 50,000+
- **RT**：P99 < 100ms，P95 < 50ms  
- **可用性**：99.99%（年故障时间 < 1 小时）
- **错误率**：< 0.01%

**业务成果**：
- 支撑日订单量从 1 万提升到 100 万+
- 双 11 峰值流量无故障运行
- 系统容量提升 10 倍，成本降低 30%

---

### 2. AI Agent 智能平台

**项目背景**：企业级 AI 助手平台，支持多场景智能化任务处理

**系统架构**：
```
┌─────────────────────────────────────────────────────────────┐
│                   AI Agent 平台架构                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户界面 ──▶ API网关 ──▶ Agent调度器 ──▶ LLM服务           │
│              │           │             │                    │
│              │           ▼             ▼                    │
│              │       工具管理器     向量数据库               │
│              │           │             │                    │
│              ▼           ▼             ▼                    │
│           权限控制    执行引擎      知识库                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心技术**：
- **后端**：Python + FastAPI + Celery
- **AI 框架**：LangChain + OpenAI API + 本地模型
- **向量数据库**：Pinecone + Chroma
- **工具集成**：RESTful API + 数据库连接器
- **部署**：Docker + Kubernetes

**Agent 设计模式**：

```python
class ReActAgent:
    """ReAct (Reasoning + Acting) Agent 实现"""
    
    def __init__(self, llm, tools, memory):
        self.llm = llm
        self.tools = {tool.name: tool for tool in tools}
        self.memory = memory
        self.max_iterations = 10
    
    async def run(self, task: str) -> str:
        """执行任务的主循环"""
        self.memory.add_message("user", task)
        
        for i in range(self.max_iterations):
            # Reasoning: 分析当前状态，决定下一步行动
            prompt = self._build_react_prompt(task)
            response = await self.llm.agenerate(prompt)
            
            # 解析 LLM 响应
            thought, action, action_input = self._parse_response(response)
            
            if action == "Final Answer":
                return action_input
            
            # Acting: 执行工具调用
            if action in self.tools:
                try:
                    result = await self.tools[action].run(action_input)
                    self.memory.add_observation(result)
                except Exception as e:
                    self.memory.add_observation(f"Error: {str(e)}")
            else:
                self.memory.add_observation(f"Unknown action: {action}")
        
        return "任务执行超时，请重试"
    
    def _build_react_prompt(self, task: str) -> str:
        """构建 ReAct 提示词"""
        return f"""
        你是一个智能助手，需要通过推理和行动来完成任务。

        可用工具：
        {self._format_tools()}

        请按照以下格式思考和行动：
        Thought: 分析当前情况，思考下一步
        Action: 选择要使用的工具
        Action Input: 工具的输入参数
        Observation: 工具执行结果

        任务: {task}
        
        历史记录:
        {self.memory.get_history()}
        
        开始思考:
        """
```

**工具生态**：

```python
# 数据库查询工具
class DatabaseTool:
    name = "database_query"
    description = "执行 SQL 查询获取数据"
    
    async def run(self, query: str) -> str:
        # 安全检查：防止 SQL 注入
        if not self._is_safe_query(query):
            return "查询包含不安全操作，已拒绝执行"
        
        result = await self.db.execute(query)
        return self._format_result(result)

# API 调用工具  
class APITool:
    name = "api_call"
    description = "调用外部 API 获取数据"
    
    async def run(self, config: dict) -> str:
        url = config.get("url")
        method = config.get("method", "GET")
        
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, **config)
            return response.json()

# 代码执行工具
class CodeExecutor:
    name = "code_execution"
    description = "在安全沙箱中执行代码"
    
    async def run(self, code: str, language: str = "python") -> str:
        # 在 Docker 容器中安全执行
        result = await self._execute_in_sandbox(code, language)
        return result
```

**RAG 增强**：

```python
class RAGService:
    """检索增强生成服务"""
    
    def __init__(self, vector_db, embedding_model):
        self.vector_db = vector_db
        self.embedding_model = embedding_model
    
    async def retrieve_context(self, query: str, top_k: int = 5) -> List[str]:
        """检索相关上下文"""
        # 1. 查询向量化
        query_embedding = await self.embedding_model.embed(query)
        
        # 2. 向量检索
        results = await self.vector_db.similarity_search(
            query_embedding, 
            top_k=top_k
        )
        
        # 3. 重排序（可选）
        reranked_results = await self._rerank(query, results)
        
        return [doc.content for doc in reranked_results]
    
    async def generate_with_context(self, query: str, context: List[str]) -> str:
        """基于上下文生成回答"""
        prompt = f"""
        基于以下上下文信息回答问题：
        
        上下文：
        {chr(10).join(context)}
        
        问题：{query}
        
        请基于上下文提供准确的回答，如果上下文中没有相关信息，请明确说明。
        """
        
        return await self.llm.agenerate(prompt)
```

**性能指标**：
- **响应时间**：平均 < 3 秒，P95 < 8 秒
- **成功率**：85%+（复杂任务）
- **并发支持**：1000+ 并发用户
- **工具覆盖**：20+ 集成工具

**应用场景**：
- **数据分析**：自动生成报表、数据可视化
- **代码助手**：代码生成、Bug 修复、重构建议  
- **客服机器人**：智能问答、工单处理
- **运维助手**：日志分析、故障诊断

---

### 3. 分布式锁治理平台

**项目背景**：解决微服务架构下的并发控制和资源竞争问题

**技术方案对比**：

| 方案 | 优势 | 劣势 | 适用场景 |
|------|------|------|----------|
| Redis 锁 | 性能高、实现简单 | 可能丢锁、时钟依赖 | 高性能场景 |
| etcd 锁 | 强一致性、自动续期 | 性能相对较低 | 强一致性要求 |
| 数据库锁 | 事务保证、易理解 | 性能瓶颈 | 简单场景 |

**Redis 分布式锁实现**：

```go
type RedisDistributedLock struct {
    client    *redis.Client
    key       string
    value     string
    ttl       time.Duration
    watchdog  *time.Ticker
    ctx       context.Context
    cancel    context.CancelFunc
}

func NewRedisLock(client *redis.Client, key string, ttl time.Duration) *RedisDistributedLock {
    ctx, cancel := context.WithCancel(context.Background())
    return &RedisDistributedLock{
        client: client,
        key:    key,
        value:  generateUniqueID(),
        ttl:    ttl,
        ctx:    ctx,
        cancel: cancel,
    }
}

func (l *RedisDistributedLock) TryLock(ctx context.Context) error {
    // Lua 脚本保证原子性
    script := `
        if redis.call('set', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
            return 1
        else
            return 0
        end
    `
    
    result, err := l.client.Eval(ctx, script, []string{l.key}, l.value, l.ttl.Milliseconds()).Result()
    if err != nil {
        return err
    }
    
    if result.(int64) == 1 {
        // 启动看门狗自动续期
        l.startWatchdog()
        return nil
    }
    
    return errors.New("获取锁失败")
}

func (l *RedisDistributedLock) Unlock(ctx context.Context) error {
    // 停止看门狗
    l.cancel()
    
    // Lua 脚本确保只能删除自己的锁
    script := `
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        else
            return 0
        end
    `
    
    _, err := l.client.Eval(ctx, script, []string{l.key}, l.value).Result()
    return err
}

func (l *RedisDistributedLock) startWatchdog() {
    // 看门狗：定期续期防止锁过期
    l.watchdog = time.NewTicker(l.ttl / 3)
    
    go func() {
        defer l.watchdog.Stop()
        
        for {
            select {
            case <-l.ctx.Done():
                return
            case <-l.watchdog.C:
                l.renewLock()
            }
        }
    }()
}

func (l *RedisDistributedLock) renewLock() {
    script := `
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('pexpire', KEYS[1], ARGV[2])
        else
            return 0
        end
    `
    
    l.client.Eval(l.ctx, script, []string{l.key}, l.value, l.ttl.Milliseconds())
}
```

**etcd 分布式锁实现**：

```go
type EtcdDistributedLock struct {
    client   *clientv3.Client
    session  *concurrency.Session
    mutex    *concurrency.Mutex
    key      string
}

func NewEtcdLock(client *clientv3.Client, key string, ttl int) (*EtcdDistributedLock, error) {
    session, err := concurrency.NewSession(client, concurrency.WithTTL(ttl))
    if err != nil {
        return nil, err
    }
    
    mutex := concurrency.NewMutex(session, key)
    
    return &EtcdDistributedLock{
        client:  client,
        session: session,
        mutex:   mutex,
        key:     key,
    }, nil
}

func (l *EtcdDistributedLock) Lock(ctx context.Context) error {
    return l.mutex.Lock(ctx)
}

func (l *EtcdDistributedLock) Unlock(ctx context.Context) error {
    err := l.mutex.Unlock(ctx)
    if err != nil {
        return err
    }
    return l.session.Close()
}
```

**统一锁接口**：

```go
// 分布式锁接口
type DistributedLock interface {
    TryLock(ctx context.Context) error
    Lock(ctx context.Context) error
    Unlock(ctx context.Context) error
    IsLocked() bool
}

// 锁管理器
type LockManager struct {
    locks map[string]DistributedLock
    mu    sync.RWMutex
}

func (m *LockManager) GetLock(key string, lockType LockType) DistributedLock {
    m.mu.RLock()
    if lock, exists := m.locks[key]; exists {
        m.mu.RUnlock()
        return lock
    }
    m.mu.RUnlock()
    
    m.mu.Lock()
    defer m.mu.Unlock()
    
    // 双重检查
    if lock, exists := m.locks[key]; exists {
        return lock
    }
    
    var lock DistributedLock
    switch lockType {
    case RedisLock:
        lock = NewRedisLock(m.redisClient, key, 30*time.Second)
    case EtcdLock:
        lock, _ = NewEtcdLock(m.etcdClient, key, 30)
    case DatabaseLock:
        lock = NewDatabaseLock(m.db, key)
    }
    
    m.locks[key] = lock
    return lock
}
```

**性能测试结果**：

```yaml
Redis 锁:
  获锁 QPS: 10000+
  平均延迟: 1-2ms
  P99 延迟: 5ms
  
etcd 锁:
  获锁 QPS: 1000+  
  平均延迟: 5-10ms
  P99 延迟: 20ms
  
数据库锁:
  获锁 QPS: 500+
  平均延迟: 10-20ms
  P99 延迟: 50ms
```

**应用效果**：
- **库存一致性**：解决超卖问题，准确率 99.99%+
- **接口幂等**：重复请求处理，成功率 100%
- **资源竞争**：消除并发冲突，错误率 < 0.01%

---

## 🚀 开源项目

### 1. Go 高性能 Web 框架

**项目地址**：[github.com/kanelli/fast-gin](https://github.com/kanelli/fast-gin)

**项目特色**：
- 基于 Gin 优化的高性能 Web 框架
- 内置限流、熔断、链路追踪
- 支持优雅关闭、健康检查
- 集成 Prometheus 监控

**核心代码**：

```go
// 框架初始化
func NewFastGin(opts ...Option) *FastGin {
    app := &FastGin{
        Engine: gin.New(),
        config: defaultConfig(),
    }
    
    // 应用配置
    for _, opt := range opts {
        opt(app)
    }
    
    // 注册中间件
    app.setupMiddlewares()
    
    return app
}

// 限流中间件
func RateLimitMiddleware(limiter *rate.Limiter) gin.HandlerFunc {
    return func(c *gin.Context) {
        if !limiter.Allow() {
            c.JSON(http.StatusTooManyRequests, gin.H{
                "error": "请求过于频繁",
            })
            c.Abort()
            return
        }
        c.Next()
    }
}

// 熔断中间件
func CircuitBreakerMiddleware(cb *breaker.CircuitBreaker) gin.HandlerFunc {
    return func(c *gin.Context) {
        err := cb.Execute(func() error {
            c.Next()
            if c.Writer.Status() >= 500 {
                return errors.New("server error")
            }
            return nil
        })
        
        if err != nil {
            c.JSON(http.StatusServiceUnavailable, gin.H{
                "error": "服务暂时不可用",
            })
            c.Abort()
        }
    }
}
```

**性能指标**：
- **QPS**：比原生 Gin 提升 20%
- **内存占用**：降低 15%
- **响应时间**：P95 < 10ms

### 2. AI 工具链

**项目地址**：[github.com/kanelli/ai-toolchain](https://github.com/kanelli/ai-toolchain)

**功能特性**：
- LLM 统一接口适配器
- Prompt 模板管理
- 向量数据库抽象层
- Agent 工作流引擎

**使用示例**：

```python
from ai_toolchain import LLMAdapter, PromptTemplate, VectorStore

# LLM 适配器
llm = LLMAdapter.create("openai", api_key="xxx")

# Prompt 模板
template = PromptTemplate.load("code_review.yaml")
prompt = template.render(code=source_code, language="python")

# 生成回答
response = await llm.generate(prompt)
print(response.content)
```

---

## 📊 技术影响力

### 技术文章
- **掘金**：10+ 技术文章，累计阅读 50万+
- **博客**：分享架构设计和性能优化经验
- **GitHub**：开源项目获得 1000+ Star

### 技术分享
- **公司内训**：微服务架构、性能调优专题
- **技术会议**：分享高并发系统设计经验
- **代码 Review**：指导团队技术方案设计

### 团队贡献
- **技术选型**：主导团队技术栈升级
- **最佳实践**：建立代码规范和开发流程
- **知识传承**：培养 5+ 高级工程师

---

## 🎯 未来规划

### 技术方向
- **AI Native**：深入 LLM 应用开发和 Agent 设计
- **云原生**：Kubernetes、Service Mesh 实践
- **性能工程**：极致性能优化和稳定性保障

### 开源计划
- 开源高性能微服务框架
- 发布 AI Agent 开发工具包
- 贡献云原生生态项目

### 学习目标
- 深入学习分布式系统理论
- 掌握 AI 大模型训练和推理
- 提升系统架构设计能力

---

通过这些项目，我积累了丰富的大规模系统设计和 AI 工程实践经验。每个项目都经历了从 0 到 1 的完整过程，包括需求分析、架构设计、技术选型、开发实现、性能优化、运维监控等各个环节。

我相信技术的价值在于解决实际问题，创造业务价值。未来我将继续在后端架构和 AI 工程领域深耕，为构建更高效、更智能的系统贡献力量。
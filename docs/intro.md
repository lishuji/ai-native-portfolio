---
sidebar_position: 1
---

# 关于我

你好，我是 **Kanelli**，一名拥有 10 年经验的后端工程师和 AI 技术专家。

## 🚀 技术背景

### 核心技能
- **后端开发**：Go、Java、PHP，专注高并发系统设计
- **AI 工程**：LLM 应用开发、AI Agent 设计、RAG 系统构建
- **架构设计**：分布式系统、微服务、云原生架构
- **数据库**：MySQL 调优、Redis 集群、分库分表实战

### 技术栈
```
Languages:    Go, Java, PHP, Python, JavaScript/TypeScript
Frameworks:   Gin, Spring Boot, Laravel, FastAPI, React
Databases:    MySQL, Redis, MongoDB, Elasticsearch
Cloud:        Kubernetes, Docker, Istio, Prometheus
AI/ML:        OpenAI API, LangChain, Transformers, Vector DB
```

---

## 💼 职业经历

### 高级后端工程师 | 2019 - 至今
**核心成就**：
- 设计并实现支撑 **百万级日订单** 的高并发电商系统
- 系统性能优化：**RT 降低 63%**，错误率控制在 **0.01%** 以下
- 主导微服务架构改造，服务可用性提升至 **99.99%**
- 建设 AI Agent 平台，支持多任务自动化处理

### 技术架构师 | 2016 - 2019
**核心成就**：
- 负责分布式系统架构设计，支撑业务 10 倍增长
- 建立完整的监控告警体系，故障发现时间缩短 80%
- 推动 DevOps 实践，部署效率提升 5 倍

---

## 🏆 核心项目

### 1. 高并发订单系统
**技术亮点**：分布式架构 + Redis Lua 幂等 + Kafka 削峰

```go
// 核心幂等实现
func (s *OrderService) CreateOrderIdempotent(ctx context.Context, req *CreateOrderRequest) (*Order, error) {
    // Redis + Lua 保证原子性
    script := `
        if redis.call('exists', KEYS[1]) == 1 then
            return redis.call('get', KEYS[1])
        else
            redis.call('setex', KEYS[1], ARGV[2], ARGV[1])
            return ARGV[1]
        end
    `
    // 实现细节...
}
```

**成果**：
- 支撑日订单量从 1 万提升到 100 万+
- 峰值 QPS 达到 5 万，RT 控制在 50ms 内
- 系统可用性 99.99%，年故障时间 < 1 小时

### 2. AI Agent 平台
**技术亮点**：LLM + Tool Calling + 工作流引擎

```python
# Agent 设计模式
class ReActAgent:
    def __init__(self, llm, tools):
        self.llm = llm
        self.tools = tools
    
    def run(self, task):
        while not self.is_complete(task):
            # Reasoning
            thought = self.llm.think(task, self.memory)
            
            # Acting
            if self.should_use_tool(thought):
                result = self.use_tool(thought.tool, thought.args)
                self.memory.add(result)
            else:
                return self.llm.respond(thought)
```

**成果**：
- 支持 ReAct、Plan-Execute、Multi-Agent 等多种模式
- 集成 20+ 工具，覆盖代码生成、数据分析、API 调用
- 任务成功率 85%+，平均处理时间 < 30 秒

### 3. 分布式锁实战
**技术亮点**：Redis + etcd + 数据库多方案对比

```go
// Redis 分布式锁实现
type RedisLock struct {
    client *redis.Client
    key    string
    value  string
    ttl    time.Duration
}

func (l *RedisLock) TryLock(ctx context.Context) error {
    script := `
        if redis.call('set', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
            return 1
        else
            return 0
        end
    `
    // 实现细节...
}
```

**成果**：
- 解决高并发场景下的库存一致性问题
- 支持可重入锁、看门狗续期、故障转移
- 锁冲突率 < 1%，平均获锁时间 < 5ms

---

## 📚 技术方法论

### 架构设计原则
1. **业务驱动**：架构服务于业务，不为技术而技术
2. **渐进演进**：小步快跑，持续迭代优化
3. **可观测性**：Metrics + Tracing + Logging 三件套
4. **故障隔离**：服务自治，避免级联故障

### 性能优化心得
```yaml
优化三板斧:
  减少请求: 缓存、批量处理、预计算
  加快处理: 并发、异步、算法优化  
  增加资源: 扩容、分片、负载均衡

缓存策略:
  L1: 本地缓存 (Caffeine)
  L2: 分布式缓存 (Redis)
  L3: CDN 缓存
  
数据库优化:
  读写分离: 主从架构
  分库分表: 水平扩展
  索引优化: 覆盖索引、复合索引
```

### AI 工程实践
- **Prompt Engineering**：Chain-of-Thought、Few-Shot Learning
- **RAG 系统**：向量检索 + 重排序 + 上下文压缩
- **Agent 设计**：工具抽象、状态管理、错误恢复
- **性能优化**：模型量化、批处理、缓存策略

---

## 🎯 技术理念

> **"技术的本质是解决问题，架构的艺术在于平衡取舍"**

我始终坚持：
- **用户第一**：技术服务于用户体验和业务价值
- **简单有效**：优先选择简单可靠的方案
- **持续学习**：保持对新技术的敏感度和学习能力
- **团队协作**：知识分享，共同成长

---

## 📖 文档导航

### AI Native 系列
- [Agent 设计模式](./ai-native/agent-design) - ReAct、Plan-Execute、Multi-Agent
- [AI 后端架构](./ai-native/ai-backend-architecture) - LLM 应用架构设计
- [Dify vs MCP 对比](./ai-native/dify-vs-mcp) - AI 平台技术选型
- [Spec Kit 实践](./ai-native/spec-kit-practice) - AI 辅助开发工具

### 架构设计系列  
- [高并发系统设计](./architecture/high-concurrency) - 缓存、限流、异步处理
- [分布式锁实战](./architecture/distributed-lock) - Redis、etcd、数据库锁
- [幂等性设计](./architecture/idempotency) - 接口幂等、消息幂等
- [数据建模实践](./architecture/data-modeling) - 建模模式、索引设计
- [系统演进设计](./architecture/system-evolution) - 单体到微服务演进

### 项目实战
- [订单系统实战](./projects/backend/order-system) - 完整的高并发系统案例

---

## 📬 联系方式

- **Email**: lishuji2547@gmail.com
- **GitHub**: [github.com/lishuji](https://github.com/lishuji)

欢迎交流技术问题，共同探讨架构设计和 AI 工程实践！
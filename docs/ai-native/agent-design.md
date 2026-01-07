---
sidebar_position: 1
---

# Agent 设计模式

在 AI Native 应用中，Agent 是核心的智能单元。本文将深入探讨 Agent 的设计原则、架构模式和最佳实践。

## 什么是 Agent

Agent 是一个能够感知环境、做出决策并采取行动的自主实体。在 LLM 时代，Agent 通常由以下组件构成：

- **大语言模型 (LLM)**：作为 Agent 的"大脑"，负责理解、推理和决策
- **记忆系统 (Memory)**：存储对话历史、用户偏好和长期知识
- **工具集 (Tools)**：扩展 Agent 的能力边界，如搜索、代码执行、API 调用等
- **规划模块 (Planning)**：将复杂任务分解为可执行的子任务

```
┌─────────────────────────────────────────────────────────┐
│                        Agent                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │     LLM     │  │   Memory    │  │     Tools       │ │
│  │  (Reasoning)│  │ (Context)   │  │  (Capabilities) │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                   │          │
│         └────────────────┼───────────────────┘          │
│                          │                              │
│                   ┌──────▼──────┐                       │
│                   │  Planning   │                       │
│                   │  (Strategy) │                       │
│                   └─────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

## 核心设计原则

### 1. 单一职责原则

每个 Agent 应该专注于一个明确的领域或任务。避免创建"万能 Agent"，而是设计多个专业化的 Agent 协同工作。

```python
# 不推荐：一个 Agent 处理所有事情
class UniversalAgent:
    def handle(self, query):
        # 处理客服、数据分析、代码生成...
        pass

# 推荐：专业化的 Agent
class CustomerServiceAgent:
    """专注于客户服务场景"""
    pass

class DataAnalysisAgent:
    """专注于数据分析任务"""
    pass

class CodeAssistantAgent:
    """专注于代码辅助"""
    pass
```

### 2. 可观测性优先

Agent 的决策过程应该是透明可追踪的。记录每一步推理、工具调用和决策依据。

```python
class ObservableAgent:
    def __init__(self):
        self.trace = []
    
    def think(self, context: str) -> str:
        thought = self.llm.reason(context)
        self.trace.append({
            "type": "thought",
            "content": thought,
            "timestamp": datetime.now()
        })
        return thought
    
    def act(self, action: str) -> str:
        result = self.execute(action)
        self.trace.append({
            "type": "action",
            "action": action,
            "result": result,
            "timestamp": datetime.now()
        })
        return result
```

### 3. 优雅降级

当 Agent 遇到无法处理的情况时，应该能够优雅地降级，而不是崩溃或给出错误答案。

```python
class ResilientAgent:
    def handle(self, query: str) -> Response:
        try:
            # 尝试使用完整能力处理
            return self.full_process(query)
        except ToolUnavailableError:
            # 工具不可用时，使用纯 LLM 推理
            return self.llm_only_process(query)
        except ConfidenceTooLowError:
            # 置信度过低时，请求人工介入
            return self.escalate_to_human(query)
        except Exception as e:
            # 兜底：承认无法处理
            return Response(
                status="failed",
                message="抱歉，我暂时无法处理这个请求，已通知人工客服"
            )
```

## 常见架构模式

### ReAct 模式

ReAct (Reasoning + Acting) 是最经典的 Agent 模式，交替进行推理和行动。

```
Thought: 用户想查询北京的天气，我需要调用天气 API
Action: weather_api(city="北京")
Observation: 北京今天晴，气温 25°C
Thought: 我已经获取到天气信息，可以回复用户了
Answer: 北京今天天气晴朗，气温 25°C，适合外出活动。
```

```python
class ReActAgent:
    def run(self, query: str) -> str:
        context = f"用户问题: {query}\n"
        
        for _ in range(self.max_iterations):
            # 思考
            thought = self.llm.think(context)
            context += f"Thought: {thought}\n"
            
            # 判断是否需要行动
            if self.should_act(thought):
                action, params = self.parse_action(thought)
                observation = self.tools[action](**params)
                context += f"Action: {action}({params})\n"
                context += f"Observation: {observation}\n"
            else:
                # 生成最终答案
                return self.llm.answer(context)
        
        return "达到最大迭代次数，无法完成任务"
```

### Plan-and-Execute 模式

先制定完整计划，再逐步执行。适合复杂的多步骤任务。

```python
class PlanAndExecuteAgent:
    def run(self, query: str) -> str:
        # 阶段1：制定计划
        plan = self.planner.create_plan(query)
        # plan = ["搜索相关文档", "提取关键信息", "生成摘要", "格式化输出"]
        
        results = []
        # 阶段2：逐步执行
        for step in plan:
            result = self.executor.execute(step, context=results)
            results.append(result)
            
            # 检查是否需要重新规划
            if self.should_replan(step, result):
                plan = self.planner.replan(query, results)
        
        return self.synthesize(results)
```

### Multi-Agent 协作模式

多个专业 Agent 协同完成复杂任务。

```python
class MultiAgentOrchestrator:
    def __init__(self):
        self.agents = {
            "researcher": ResearchAgent(),
            "writer": WriterAgent(),
            "reviewer": ReviewerAgent(),
        }
    
    def run(self, task: str) -> str:
        # 研究员收集信息
        research = self.agents["researcher"].run(task)
        
        # 写作者生成初稿
        draft = self.agents["writer"].run(
            task=task,
            research=research
        )
        
        # 审核者评审并提供反馈
        review = self.agents["reviewer"].run(draft)
        
        # 如果需要修改，循环迭代
        while review.needs_revision:
            draft = self.agents["writer"].revise(draft, review.feedback)
            review = self.agents["reviewer"].run(draft)
        
        return draft
```

## 记忆系统设计

### 短期记忆

存储当前对话上下文，通常使用滑动窗口或摘要压缩。

```python
class ShortTermMemory:
    def __init__(self, max_tokens: int = 4000):
        self.messages = []
        self.max_tokens = max_tokens
    
    def add(self, message: dict):
        self.messages.append(message)
        self._compress_if_needed()
    
    def _compress_if_needed(self):
        while self._count_tokens() > self.max_tokens:
            # 策略1：移除最早的消息
            # self.messages.pop(0)
            
            # 策略2：摘要压缩
            old_messages = self.messages[:5]
            summary = self.llm.summarize(old_messages)
            self.messages = [{"role": "system", "content": summary}] + self.messages[5:]
```

### 长期记忆

使用向量数据库存储和检索历史知识。

```python
class LongTermMemory:
    def __init__(self):
        self.vector_store = VectorStore()
        self.embedding_model = EmbeddingModel()
    
    def store(self, content: str, metadata: dict = None):
        embedding = self.embedding_model.encode(content)
        self.vector_store.insert(
            embedding=embedding,
            content=content,
            metadata=metadata
        )
    
    def retrieve(self, query: str, top_k: int = 5) -> list:
        query_embedding = self.embedding_model.encode(query)
        return self.vector_store.search(query_embedding, top_k=top_k)
```

## 工具设计最佳实践

### 1. 清晰的工具描述

工具描述决定了 LLM 能否正确理解和使用工具。

```python
# 不推荐：模糊的描述
@tool(description="搜索")
def search(query: str):
    pass

# 推荐：详细清晰的描述
@tool(
    name="web_search",
    description="""
    在互联网上搜索信息。适用于：
    - 查询最新新闻和事件
    - 获取实时数据（股价、天气等）
    - 搜索特定网站或文档
    
    不适用于：
    - 查询用户的私有数据
    - 需要登录才能访问的内容
    """,
    parameters={
        "query": {
            "type": "string",
            "description": "搜索关键词，建议使用精确的关键词组合"
        },
        "num_results": {
            "type": "integer",
            "description": "返回结果数量，默认5条",
            "default": 5
        }
    }
)
def web_search(query: str, num_results: int = 5):
    pass
```

### 2. 错误处理和重试

```python
@tool(name="api_call")
def api_call(endpoint: str, params: dict) -> dict:
    for attempt in range(3):
        try:
            response = requests.get(endpoint, params=params, timeout=10)
            response.raise_for_status()
            return {"success": True, "data": response.json()}
        except requests.Timeout:
            if attempt == 2:
                return {"success": False, "error": "请求超时，请稍后重试"}
        except requests.HTTPError as e:
            return {"success": False, "error": f"API 错误: {e.response.status_code}"}
    
    return {"success": False, "error": "未知错误"}
```

## 安全考虑

### 1. Prompt 注入防护

```python
class SecureAgent:
    def sanitize_input(self, user_input: str) -> str:
        # 检测潜在的 prompt 注入
        injection_patterns = [
            r"ignore previous instructions",
            r"system prompt",
            r"你是一个",
        ]
        
        for pattern in injection_patterns:
            if re.search(pattern, user_input, re.IGNORECASE):
                raise SecurityError("检测到潜在的 prompt 注入")
        
        return user_input
    
    def run(self, query: str) -> str:
        safe_query = self.sanitize_input(query)
        return self._process(safe_query)
```

### 2. 工具调用权限控制

```python
class PermissionManager:
    def __init__(self):
        self.permissions = {
            "read_file": ["admin", "developer"],
            "write_file": ["admin"],
            "execute_code": ["admin"],
            "web_search": ["admin", "developer", "user"],
        }
    
    def check(self, tool: str, user_role: str) -> bool:
        allowed_roles = self.permissions.get(tool, [])
        return user_role in allowed_roles
```

## 性能优化

### 1. 并行工具调用

```python
import asyncio

class ParallelAgent:
    async def run_tools_parallel(self, tool_calls: list) -> list:
        tasks = [
            self.execute_tool(call["name"], call["params"])
            for call in tool_calls
        ]
        return await asyncio.gather(*tasks)
```

### 2. 缓存策略

```python
from functools import lru_cache

class CachedAgent:
    @lru_cache(maxsize=1000)
    def get_embedding(self, text: str) -> list:
        return self.embedding_model.encode(text)
    
    def search_with_cache(self, query: str) -> list:
        # 相同查询直接返回缓存结果
        cache_key = hashlib.md5(query.encode()).hexdigest()
        if cache_key in self.search_cache:
            return self.search_cache[cache_key]
        
        result = self.vector_store.search(query)
        self.search_cache[cache_key] = result
        return result
```

## 总结

设计一个优秀的 Agent 需要考虑多个维度：

1. **架构选择**：根据任务复杂度选择 ReAct、Plan-and-Execute 或 Multi-Agent 模式
2. **记忆管理**：合理设计短期和长期记忆，平衡上下文长度和信息完整性
3. **工具设计**：提供清晰的描述，做好错误处理
4. **安全防护**：防范 prompt 注入，控制工具权限
5. **性能优化**：使用并行调用和缓存提升响应速度

Agent 设计是一个不断演进的领域，随着 LLM 能力的提升，我们可以期待更强大、更智能的 Agent 架构出现。

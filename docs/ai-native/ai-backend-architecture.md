---
sidebar_position: 2
---

# AI 后端架构设计

构建生产级 AI 应用需要一套完善的后端架构。本文将介绍如何设计可扩展、高可用的 AI 后端系统。

## 整体架构

```
                                    ┌─────────────────────────────────────────────────────────┐
                                    │                    Load Balancer                        │
                                    └─────────────────────────┬───────────────────────────────┘
                                                              │
                    ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
                    │                                         │                                         │
           ┌────────▼────────┐                       ┌────────▼────────┐                       ┌────────▼────────┐
           │   API Gateway   │                       │   API Gateway   │                       │   API Gateway   │
           └────────┬────────┘                       └────────┬────────┘                       └────────┬────────┘
                    │                                         │                                         │
                    └─────────────────────────────────────────┼─────────────────────────────────────────┘
                                                              │
        ┌──────────────────┬──────────────────┬───────────────┼───────────────┬──────────────────┬──────────────────┐
        │                  │                  │               │               │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐  ┌────▼────┐  ┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│  Chat Service │  │ Agent Service │  │  RAG Service  │  │  Auth   │  │ Embedding Svc │  │ Vector Store  │  │  Model Router │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └─────────┘  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │                               │                  │                  │
        └──────────────────┴──────────────────┴───────────────────────────────┴──────────────────┴──────────────────┘
                                                              │
                    ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
                    │                                         │                                         │
           ┌────────▼────────┐                       ┌────────▼────────┐                       ┌────────▼────────┐
           │   PostgreSQL    │                       │      Redis      │                       │   Milvus/PG     │
           │   (Metadata)    │                       │   (Cache/MQ)    │                       │   (Vectors)     │
           └─────────────────┘                       └─────────────────┘                       └─────────────────┘
```

## 核心服务设计

### 1. API Gateway

API Gateway 是系统的入口，负责请求路由、认证鉴权、限流熔断。

```python
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import time

app = FastAPI()

# 限流中间件
class RateLimiter:
    def __init__(self, redis_client, rate: int = 100, window: int = 60):
        self.redis = redis_client
        self.rate = rate  # 每个窗口期允许的请求数
        self.window = window  # 窗口期（秒）
    
    async def is_allowed(self, user_id: str) -> bool:
        key = f"rate_limit:{user_id}"
        current = await self.redis.incr(key)
        if current == 1:
            await self.redis.expire(key, self.window)
        return current <= self.rate

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    user_id = request.headers.get("X-User-ID", request.client.host)
    
    if not await rate_limiter.is_allowed(user_id):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后重试")
    
    response = await call_next(request)
    return response
```

### 2. Chat Service

处理对话请求，支持流式响应。

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator
import json

app = FastAPI()

class ChatService:
    def __init__(self, model_router, memory_store):
        self.model_router = model_router
        self.memory_store = memory_store
    
    async def chat_stream(
        self, 
        conversation_id: str,
        message: str,
        model: str = "gpt-4"
    ) -> AsyncGenerator[str, None]:
        # 1. 加载对话历史
        history = await self.memory_store.get_history(conversation_id)
        
        # 2. 构建消息
        messages = history + [{"role": "user", "content": message}]
        
        # 3. 流式调用模型
        full_response = ""
        async for chunk in self.model_router.stream(model, messages):
            full_response += chunk
            yield f"data: {json.dumps({'content': chunk})}\n\n"
        
        # 4. 保存对话记录
        await self.memory_store.append(conversation_id, [
            {"role": "user", "content": message},
            {"role": "assistant", "content": full_response}
        ])
        
        yield "data: [DONE]\n\n"

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    return StreamingResponse(
        chat_service.chat_stream(
            conversation_id=request.conversation_id,
            message=request.message,
            model=request.model
        ),
        media_type="text/event-stream"
    )
```

### 3. Model Router

统一管理多个 LLM 提供商，实现智能路由和故障转移。

```python
from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict
import asyncio

class LLMProvider(ABC):
    @abstractmethod
    async def stream(self, messages: List[Dict]) -> AsyncGenerator[str, None]:
        pass
    
    @abstractmethod
    async def health_check(self) -> bool:
        pass

class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, base_url: str = None):
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    
    async def stream(self, messages: List[Dict], model: str = "gpt-4") -> AsyncGenerator[str, None]:
        response = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )
        async for chunk in response:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

class ModelRouter:
    def __init__(self):
        self.providers: Dict[str, List[LLMProvider]] = {
            "gpt-4": [
                OpenAIProvider(api_key="key1"),
                OpenAIProvider(api_key="key2", base_url="https://backup.api.com"),
            ],
            "claude-3": [
                ClaudeProvider(api_key="claude_key"),
            ],
        }
        self.health_status: Dict[str, bool] = {}
    
    async def stream(self, model: str, messages: List[Dict]) -> AsyncGenerator[str, None]:
        providers = self.providers.get(model, [])
        
        for provider in providers:
            if not self.health_status.get(id(provider), True):
                continue
            
            try:
                async for chunk in provider.stream(messages, model):
                    yield chunk
                return
            except Exception as e:
                # 标记为不健康，稍后重试
                self.health_status[id(provider)] = False
                asyncio.create_task(self._recover_provider(provider))
                continue
        
        raise Exception(f"所有 {model} 提供商均不可用")
    
    async def _recover_provider(self, provider: LLMProvider):
        """定期检查提供商健康状态"""
        await asyncio.sleep(60)
        if await provider.health_check():
            self.health_status[id(provider)] = True
```

### 4. RAG Service

检索增强生成服务，整合向量检索和 LLM 生成。

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class Document:
    id: str
    content: str
    metadata: dict
    score: float = 0.0

class RAGService:
    def __init__(
        self,
        embedding_service,
        vector_store,
        llm_service,
        reranker=None
    ):
        self.embedding = embedding_service
        self.vector_store = vector_store
        self.llm = llm_service
        self.reranker = reranker
    
    async def query(
        self,
        question: str,
        top_k: int = 10,
        rerank_top_k: int = 3,
        filters: dict = None
    ) -> str:
        # 1. 生成查询向量
        query_embedding = await self.embedding.encode(question)
        
        # 2. 向量检索
        candidates = await self.vector_store.search(
            embedding=query_embedding,
            top_k=top_k,
            filters=filters
        )
        
        # 3. 重排序（可选）
        if self.reranker and len(candidates) > rerank_top_k:
            candidates = await self.reranker.rerank(
                query=question,
                documents=candidates,
                top_k=rerank_top_k
            )
        
        # 4. 构建 Prompt
        context = self._build_context(candidates)
        prompt = f"""基于以下参考资料回答用户问题。如果参考资料中没有相关信息，请明确说明。

参考资料：
{context}

用户问题：{question}

回答："""
        
        # 5. 生成回答
        response = await self.llm.generate(prompt)
        
        return {
            "answer": response,
            "sources": [{"id": doc.id, "score": doc.score} for doc in candidates]
        }
    
    def _build_context(self, documents: List[Document]) -> str:
        context_parts = []
        for i, doc in enumerate(documents, 1):
            context_parts.append(f"[{i}] {doc.content}")
        return "\n\n".join(context_parts)
```

### 5. Embedding Service

高性能向量化服务，支持批量处理和缓存。

```python
import hashlib
from typing import List
import numpy as np

class EmbeddingService:
    def __init__(self, model_name: str, cache: Redis, batch_size: int = 32):
        self.model = SentenceTransformer(model_name)
        self.cache = cache
        self.batch_size = batch_size
        self.dimension = self.model.get_sentence_embedding_dimension()
    
    async def encode(self, text: str) -> List[float]:
        """单条文本编码，带缓存"""
        cache_key = f"emb:{hashlib.md5(text.encode()).hexdigest()}"
        
        # 尝试从缓存获取
        cached = await self.cache.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # 计算向量
        embedding = self.model.encode(text).tolist()
        
        # 写入缓存（7天过期）
        await self.cache.setex(cache_key, 7 * 24 * 3600, json.dumps(embedding))
        
        return embedding
    
    async def encode_batch(self, texts: List[str]) -> List[List[float]]:
        """批量编码，优化吞吐量"""
        results = [None] * len(texts)
        uncached_indices = []
        uncached_texts = []
        
        # 1. 批量查询缓存
        cache_keys = [f"emb:{hashlib.md5(t.encode()).hexdigest()}" for t in texts]
        cached_values = await self.cache.mget(cache_keys)
        
        for i, cached in enumerate(cached_values):
            if cached:
                results[i] = json.loads(cached)
            else:
                uncached_indices.append(i)
                uncached_texts.append(texts[i])
        
        # 2. 批量计算未缓存的向量
        if uncached_texts:
            embeddings = self.model.encode(
                uncached_texts,
                batch_size=self.batch_size,
                show_progress_bar=False
            )
            
            # 3. 写入结果和缓存
            pipe = self.cache.pipeline()
            for idx, embedding in zip(uncached_indices, embeddings):
                emb_list = embedding.tolist()
                results[idx] = emb_list
                pipe.setex(cache_keys[idx], 7 * 24 * 3600, json.dumps(emb_list))
            await pipe.execute()
        
        return results
```

## 数据存储设计

### 对话存储

```python
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    title = Column(String(255))
    model = Column(String(50), default="gpt-4")
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "messages"
    
    id = Column(String(36), primary_key=True)
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user, assistant, system
    content = Column(Text, nullable=False)
    tokens = Column(Integer, default=0)
    metadata = Column(JSON, default={})  # 工具调用、引用来源等
    created_at = Column(DateTime, default=datetime.utcnow)
    
    conversation = relationship("Conversation", back_populates="messages")
```

### 向量存储

使用 pgvector 扩展实现向量存储：

```sql
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 文档表
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),  -- OpenAI ada-002 维度
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建向量索引（IVFFlat）
CREATE INDEX ON documents 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 相似度搜索函数
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1536),
    match_count INT DEFAULT 10,
    filter_collection UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.content,
        d.metadata,
        1 - (d.embedding <=> query_embedding) AS similarity
    FROM documents d
    WHERE (filter_collection IS NULL OR d.collection_id = filter_collection)
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

## 异步任务处理

使用 Celery 处理耗时任务：

```python
from celery import Celery
from celery.result import AsyncResult

celery_app = Celery(
    "ai_tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1"
)

@celery_app.task(bind=True, max_retries=3)
def process_document(self, document_id: str, file_path: str):
    """文档处理任务：解析、分块、向量化"""
    try:
        # 1. 解析文档
        content = parse_document(file_path)
        
        # 2. 文本分块
        chunks = text_splitter.split(content, chunk_size=500, overlap=50)
        
        # 3. 批量向量化
        embeddings = embedding_service.encode_batch([c.text for c in chunks])
        
        # 4. 存入向量库
        vector_store.insert_batch(
            ids=[f"{document_id}_{i}" for i in range(len(chunks))],
            embeddings=embeddings,
            contents=[c.text for c in chunks],
            metadata=[{"document_id": document_id, "chunk_index": i} for i in range(len(chunks))]
        )
        
        # 5. 更新文档状态
        update_document_status(document_id, "completed")
        
    except Exception as e:
        update_document_status(document_id, "failed", str(e))
        raise self.retry(exc=e, countdown=60)

@celery_app.task
def cleanup_expired_conversations():
    """定期清理过期对话"""
    cutoff = datetime.utcnow() - timedelta(days=30)
    deleted = db.query(Conversation).filter(
        Conversation.updated_at < cutoff
    ).delete()
    return f"Deleted {deleted} expired conversations"
```

## 可观测性

### 日志设计

```python
import structlog
from opentelemetry import trace

# 结构化日志配置
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
    ]
)

logger = structlog.get_logger()

class ObservableLLMService:
    def __init__(self, llm_client):
        self.client = llm_client
        self.tracer = trace.get_tracer(__name__)
    
    async def generate(self, messages: List[Dict], **kwargs) -> str:
        with self.tracer.start_as_current_span("llm_generate") as span:
            start_time = time.time()
            
            # 记录请求信息
            span.set_attribute("model", kwargs.get("model", "default"))
            span.set_attribute("message_count", len(messages))
            
            try:
                response = await self.client.generate(messages, **kwargs)
                
                # 记录响应指标
                latency = time.time() - start_time
                span.set_attribute("latency_ms", latency * 1000)
                span.set_attribute("output_tokens", count_tokens(response))
                
                logger.info(
                    "llm_request_completed",
                    model=kwargs.get("model"),
                    latency_ms=latency * 1000,
                    input_tokens=sum(count_tokens(m["content"]) for m in messages),
                    output_tokens=count_tokens(response)
                )
                
                return response
                
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.Status(trace.StatusCode.ERROR))
                logger.error("llm_request_failed", error=str(e))
                raise
```

### 指标监控

```python
from prometheus_client import Counter, Histogram, Gauge

# 定义指标
llm_requests_total = Counter(
    "llm_requests_total",
    "Total LLM requests",
    ["model", "status"]
)

llm_request_duration = Histogram(
    "llm_request_duration_seconds",
    "LLM request duration",
    ["model"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)

llm_tokens_total = Counter(
    "llm_tokens_total",
    "Total tokens processed",
    ["model", "type"]  # type: input/output
)

active_conversations = Gauge(
    "active_conversations",
    "Number of active conversations"
)

# 使用指标
class MetricsMiddleware:
    async def __call__(self, request, call_next):
        model = request.headers.get("X-Model", "unknown")
        
        with llm_request_duration.labels(model=model).time():
            try:
                response = await call_next(request)
                llm_requests_total.labels(model=model, status="success").inc()
                return response
            except Exception as e:
                llm_requests_total.labels(model=model, status="error").inc()
                raise
```

## 部署架构

### Kubernetes 部署示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chat-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: chat-service
  template:
    metadata:
      labels:
        app: chat-service
    spec:
      containers:
      - name: chat-service
        image: ai-platform/chat-service:v1.0.0
        ports:
        - containerPort: 8000
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        env:
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: ai-platform-secrets
              key: redis-url
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: ai-platform-secrets
              key: database-url
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: chat-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: chat-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "100"
```

## 成本优化

### Token 用量控制

```python
class TokenBudgetManager:
    def __init__(self, redis_client):
        self.redis = redis_client
    
    async def check_and_consume(
        self,
        user_id: str,
        estimated_tokens: int,
        model: str
    ) -> bool:
        """检查并消费 token 配额"""
        budget_key = f"token_budget:{user_id}:{model}"
        
        # 获取当前配额
        current = await self.redis.get(budget_key)
        if current is None:
            # 新用户，设置默认配额
            await self.redis.setex(budget_key, 86400, 100000)  # 每日10万token
            current = 100000
        else:
            current = int(current)
        
        if current < estimated_tokens:
            return False
        
        # 扣减配额
        await self.redis.decrby(budget_key, estimated_tokens)
        return True
    
    async def refund(self, user_id: str, tokens: int, model: str):
        """退还未使用的 token"""
        budget_key = f"token_budget:{user_id}:{model}"
        await self.redis.incrby(budget_key, tokens)
```

### 模型降级策略

```python
class CostAwareRouter:
    MODEL_COSTS = {
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-3.5-turbo": {"input": 0.001, "output": 0.002},
        "claude-3-opus": {"input": 0.015, "output": 0.075},
        "claude-3-sonnet": {"input": 0.003, "output": 0.015},
    }
    
    def select_model(
        self,
        task_complexity: str,
        user_tier: str,
        budget_remaining: float
    ) -> str:
        """根据任务复杂度和预算选择模型"""
        
        if user_tier == "premium" and budget_remaining > 1.0:
            if task_complexity == "high":
                return "gpt-4"
            return "gpt-3.5-turbo"
        
        if task_complexity == "high" and budget_remaining > 0.5:
            return "claude-3-sonnet"
        
        # 默认使用最经济的模型
        return "gpt-3.5-turbo"
```

## 总结

构建生产级 AI 后端需要关注：

1. **服务拆分**：Chat、RAG、Embedding、Model Router 等服务职责清晰
2. **高可用**：多提供商支持、故障转移、健康检查
3. **性能优化**：流式响应、批量处理、多级缓存
4. **可观测性**：结构化日志、分布式追踪、指标监控
5. **成本控制**：Token 配额、模型降级、用量统计
6. **弹性扩展**：Kubernetes 部署、HPA 自动扩缩容

这套架构已在多个生产环境验证，支撑日均百万级 AI 对话请求。

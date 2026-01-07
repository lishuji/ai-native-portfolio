---
sidebar_position: 4
---

# Spec Kit 实践：AI 驱动的需求到代码

Spec Kit 是一种 AI Native 的开发范式，通过结构化的规格说明 (Specification) 驱动 AI 生成高质量代码。本文将分享 Spec Kit 的核心理念和实践经验。

## 什么是 Spec Kit

传统开发流程中，需求文档和代码之间存在鸿沟。Spec Kit 的核心思想是：**用机器可理解的规格说明作为需求与代码之间的桥梁**。

```
┌─────────────────────────────────────────────────────────────┐
│                    传统开发流程                              │
│                                                             │
│  需求文档 ──► 人工理解 ──► 设计 ──► 编码 ──► 测试 ──► 交付   │
│     ↑                                                       │
│     └──────────── 信息损失、理解偏差 ────────────────────────│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Spec Kit 开发流程                         │
│                                                             │
│  需求 ──► Spec ──► AI 生成 ──► 人工审核 ──► 迭代 ──► 交付    │
│            ↑          ↓                                     │
│            └────── 反馈优化 ──────────────────────────────── │
└─────────────────────────────────────────────────────────────┘
```

## Spec 的结构设计

一个完整的 Spec 包含以下部分：

### 1. 元信息 (Meta)

```yaml
# spec/user-management.spec.yaml
meta:
  name: user-management
  version: 1.0.0
  description: 用户管理模块
  author: kanelli
  created_at: 2025-01-07
  tags:
    - backend
    - core
```

### 2. 数据模型 (Models)

```yaml
models:
  User:
    description: 用户实体
    fields:
      id:
        type: uuid
        primary: true
        description: 用户唯一标识
      username:
        type: string
        length: [3, 32]
        unique: true
        pattern: "^[a-zA-Z][a-zA-Z0-9_]*$"
        description: 用户名，字母开头，只能包含字母数字下划线
      email:
        type: email
        unique: true
        description: 邮箱地址
      password_hash:
        type: string
        internal: true  # 不暴露给 API
        description: 密码哈希
      status:
        type: enum
        values: [active, inactive, banned]
        default: active
        description: 用户状态
      created_at:
        type: datetime
        auto: create
      updated_at:
        type: datetime
        auto: update
    
    indexes:
      - fields: [username]
        unique: true
      - fields: [email]
        unique: true
      - fields: [status, created_at]
```

### 3. API 定义 (APIs)

```yaml
apis:
  createUser:
    method: POST
    path: /users
    description: 创建新用户
    auth: admin
    request:
      body:
        username:
          type: string
          required: true
        email:
          type: email
          required: true
        password:
          type: string
          min_length: 8
          required: true
    response:
      201:
        description: 创建成功
        body:
          $ref: "#/models/User"
      400:
        description: 参数错误
        body:
          code: string
          message: string
      409:
        description: 用户名或邮箱已存在
    
  getUser:
    method: GET
    path: /users/{id}
    description: 获取用户详情
    auth: user
    params:
      id:
        type: uuid
        required: true
    response:
      200:
        body:
          $ref: "#/models/User"
      404:
        description: 用户不存在

  listUsers:
    method: GET
    path: /users
    description: 获取用户列表
    auth: admin
    query:
      page:
        type: integer
        default: 1
        min: 1
      page_size:
        type: integer
        default: 20
        min: 1
        max: 100
      status:
        type: enum
        values: [active, inactive, banned]
        optional: true
      keyword:
        type: string
        optional: true
        description: 搜索用户名或邮箱
    response:
      200:
        body:
          items:
            type: array
            items:
              $ref: "#/models/User"
          total: integer
          page: integer
          page_size: integer
```

### 4. 业务规则 (Rules)

```yaml
rules:
  password:
    - name: complexity
      description: 密码必须包含大小写字母和数字
      pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$"
    - name: not_username
      description: 密码不能与用户名相同
      
  user:
    - name: unique_username
      description: 用户名全局唯一
      type: unique
      field: username
      
    - name: unique_email
      description: 邮箱全局唯一
      type: unique
      field: email
      
    - name: ban_requires_reason
      description: 封禁用户时必须提供原因
      when: "status == 'banned'"
      require: ban_reason
```

### 5. 测试用例 (Tests)

```yaml
tests:
  createUser:
    - name: success
      description: 正常创建用户
      request:
        username: testuser
        email: test@example.com
        password: Test1234
      expect:
        status: 201
        body:
          username: testuser
          email: test@example.com
          status: active
          
    - name: duplicate_username
      description: 用户名重复
      setup:
        - createUser:
            username: existuser
            email: exist@example.com
            password: Test1234
      request:
        username: existuser
        email: new@example.com
        password: Test1234
      expect:
        status: 409
        body:
          code: USER_EXISTS
          
    - name: weak_password
      description: 密码强度不足
      request:
        username: testuser
        email: test@example.com
        password: "123456"
      expect:
        status: 400
        body:
          code: WEAK_PASSWORD
```

## 从 Spec 生成代码

### 代码生成器架构

```python
class SpecCodeGenerator:
    def __init__(self, spec_path: str, target_lang: str = "python"):
        self.spec = self.load_spec(spec_path)
        self.target_lang = target_lang
        self.templates = self.load_templates(target_lang)
    
    def generate(self, output_dir: str):
        """生成完整项目代码"""
        # 1. 生成数据模型
        models = self.generate_models()
        
        # 2. 生成 API 路由
        routes = self.generate_routes()
        
        # 3. 生成业务逻辑
        services = self.generate_services()
        
        # 4. 生成测试用例
        tests = self.generate_tests()
        
        # 5. 生成配置文件
        configs = self.generate_configs()
        
        # 写入文件
        self.write_files(output_dir, {
            "models": models,
            "routes": routes,
            "services": services,
            "tests": tests,
            "configs": configs,
        })
    
    def generate_models(self) -> dict[str, str]:
        """生成数据模型代码"""
        result = {}
        for name, model in self.spec["models"].items():
            code = self.templates["model"].render(
                name=name,
                fields=model["fields"],
                indexes=model.get("indexes", []),
            )
            result[f"{snake_case(name)}.py"] = code
        return result
```

### AI 增强的代码生成

结合 LLM 生成更智能的代码：

```python
class AIEnhancedGenerator:
    def __init__(self, spec: dict, llm_client):
        self.spec = spec
        self.llm = llm_client
    
    async def generate_service(self, api_name: str) -> str:
        """使用 AI 生成业务逻辑"""
        api_spec = self.spec["apis"][api_name]
        rules = self.get_related_rules(api_name)
        
        prompt = f"""
根据以下 API 规格和业务规则，生成 Python 服务层代码。

## API 规格
```yaml
{yaml.dump(api_spec)}
```

## 相关业务规则
```yaml
{yaml.dump(rules)}
```

## 要求
1. 使用 async/await 异步编程
2. 完善的错误处理和日志记录
3. 参数验证使用 Pydantic
4. 遵循 Clean Architecture 原则
5. 包含详细的 docstring

请生成完整的服务层代码：
"""
        
        response = await self.llm.generate(prompt)
        return self.post_process(response)
    
    async def generate_tests(self, api_name: str) -> str:
        """使用 AI 生成测试代码"""
        api_spec = self.spec["apis"][api_name]
        test_cases = self.spec["tests"].get(api_name, [])
        
        prompt = f"""
根据以下 API 规格和测试用例，生成 pytest 测试代码。

## API 规格
```yaml
{yaml.dump(api_spec)}
```

## 测试用例
```yaml
{yaml.dump(test_cases)}
```

## 要求
1. 使用 pytest 和 pytest-asyncio
2. 使用 fixture 管理测试数据
3. 覆盖正常流程和边界情况
4. 包含性能测试用例

请生成完整的测试代码：
"""
        
        response = await self.llm.generate(prompt)
        return response
```

## 实践案例：订单系统

### Spec 定义

```yaml
# spec/order-system.spec.yaml
meta:
  name: order-system
  version: 1.0.0
  description: 电商订单系统

models:
  Order:
    fields:
      id:
        type: uuid
        primary: true
      user_id:
        type: uuid
        ref: User
      status:
        type: enum
        values: [pending, paid, shipped, delivered, cancelled]
        default: pending
      total_amount:
        type: decimal
        precision: [10, 2]
      items:
        type: array
        items:
          $ref: "#/models/OrderItem"
      created_at:
        type: datetime
        auto: create

  OrderItem:
    fields:
      product_id:
        type: uuid
        ref: Product
      quantity:
        type: integer
        min: 1
      unit_price:
        type: decimal
        precision: [10, 2]
      subtotal:
        type: decimal
        precision: [10, 2]
        computed: "quantity * unit_price"

apis:
  createOrder:
    method: POST
    path: /orders
    auth: user
    request:
      body:
        items:
          type: array
          min_items: 1
          items:
            product_id: uuid
            quantity: integer
    response:
      201:
        body:
          $ref: "#/models/Order"
    
  payOrder:
    method: POST
    path: /orders/{id}/pay
    auth: user
    params:
      id:
        type: uuid
    request:
      body:
        payment_method:
          type: enum
          values: [wechat, alipay, credit_card]
    response:
      200:
        body:
          order:
            $ref: "#/models/Order"
          payment_url: string

rules:
  order:
    - name: stock_check
      description: 下单时检查库存
      when: createOrder
      action: check_stock
      
    - name: price_lock
      description: 下单时锁定商品价格
      when: createOrder
      action: lock_price
      
    - name: payment_timeout
      description: 订单30分钟未支付自动取消
      when: "status == 'pending'"
      timeout: 30m
      action: cancel_order
      
    - name: idempotent_payment
      description: 支付接口幂等
      when: payOrder
      idempotent_key: "{order_id}:{payment_method}"
```

### 生成的代码示例

```python
# 生成的 models/order.py
from sqlalchemy import Column, String, Enum, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime

from .base import Base

class OrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

class Order(Base):
    __tablename__ = "orders"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default=OrderStatus.PENDING)
    total_amount = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    user = relationship("User", back_populates="orders")


class OrderItem(Base):
    __tablename__ = "order_items"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)
    
    order = relationship("Order", back_populates="items")
    product = relationship("Product")
```

```python
# 生成的 services/order_service.py
from decimal import Decimal
from uuid import UUID
from datetime import datetime, timedelta
import structlog

from models.order import Order, OrderItem, OrderStatus
from repositories.order_repository import OrderRepository
from repositories.product_repository import ProductRepository
from services.stock_service import StockService
from services.payment_service import PaymentService
from exceptions import BusinessError, StockInsufficientError

logger = structlog.get_logger()

class OrderService:
    def __init__(
        self,
        order_repo: OrderRepository,
        product_repo: ProductRepository,
        stock_service: StockService,
        payment_service: PaymentService,
    ):
        self.order_repo = order_repo
        self.product_repo = product_repo
        self.stock_service = stock_service
        self.payment_service = payment_service
    
    async def create_order(
        self,
        user_id: UUID,
        items: list[dict],
    ) -> Order:
        """
        创建订单
        
        业务规则:
        - 检查库存是否充足
        - 锁定商品价格
        - 30分钟未支付自动取消
        """
        logger.info("creating_order", user_id=str(user_id), item_count=len(items))
        
        # 1. 获取商品信息并检查库存
        order_items = []
        total_amount = Decimal("0")
        
        for item in items:
            product = await self.product_repo.get(item["product_id"])
            if not product:
                raise BusinessError(f"商品不存在: {item['product_id']}")
            
            # 检查库存
            available = await self.stock_service.check_stock(
                product.id, item["quantity"]
            )
            if not available:
                raise StockInsufficientError(product.name)
            
            # 锁定价格
            subtotal = product.price * item["quantity"]
            order_items.append(OrderItem(
                product_id=product.id,
                quantity=item["quantity"],
                unit_price=product.price,
                subtotal=subtotal,
            ))
            total_amount += subtotal
        
        # 2. 预扣库存
        for item in order_items:
            await self.stock_service.reserve(item.product_id, item.quantity)
        
        # 3. 创建订单
        order = Order(
            user_id=user_id,
            status=OrderStatus.PENDING,
            total_amount=total_amount,
            items=order_items,
        )
        
        await self.order_repo.save(order)
        
        # 4. 设置超时取消任务
        await self.schedule_cancel(order.id, timedelta(minutes=30))
        
        logger.info("order_created", order_id=str(order.id), total=str(total_amount))
        return order
    
    async def pay_order(
        self,
        order_id: UUID,
        user_id: UUID,
        payment_method: str,
    ) -> dict:
        """
        支付订单
        
        业务规则:
        - 幂等性: 相同订单+支付方式只处理一次
        """
        # 幂等性检查
        idempotent_key = f"{order_id}:{payment_method}"
        existing = await self.payment_service.get_by_idempotent_key(idempotent_key)
        if existing:
            return existing
        
        order = await self.order_repo.get(order_id)
        if not order:
            raise BusinessError("订单不存在")
        
        if order.user_id != user_id:
            raise BusinessError("无权操作此订单")
        
        if order.status != OrderStatus.PENDING:
            raise BusinessError(f"订单状态不允许支付: {order.status}")
        
        # 创建支付
        payment_result = await self.payment_service.create_payment(
            order_id=order.id,
            amount=order.total_amount,
            method=payment_method,
            idempotent_key=idempotent_key,
        )
        
        return {
            "order": order,
            "payment_url": payment_result.payment_url,
        }
```

## Spec 验证与同步

### Spec 验证器

```python
from jsonschema import validate, ValidationError
from typing import List

class SpecValidator:
    def __init__(self):
        self.errors: List[str] = []
    
    def validate(self, spec: dict) -> bool:
        """验证 Spec 完整性和一致性"""
        self.errors = []
        
        # 1. 验证必需字段
        self._validate_required_fields(spec)
        
        # 2. 验证模型引用
        self._validate_model_refs(spec)
        
        # 3. 验证 API 定义
        self._validate_apis(spec)
        
        # 4. 验证规则一致性
        self._validate_rules(spec)
        
        return len(self.errors) == 0
    
    def _validate_model_refs(self, spec: dict):
        """验证所有模型引用都存在"""
        model_names = set(spec.get("models", {}).keys())
        
        for api_name, api in spec.get("apis", {}).items():
            # 检查响应中的模型引用
            for status, response in api.get("response", {}).items():
                if "body" in response:
                    ref = response["body"].get("$ref", "")
                    if ref.startswith("#/models/"):
                        model_name = ref.split("/")[-1]
                        if model_name not in model_names:
                            self.errors.append(
                                f"API {api_name}: 引用了不存在的模型 {model_name}"
                            )
```

### 代码与 Spec 同步检查

```python
class SpecSyncChecker:
    """检查代码是否与 Spec 保持同步"""
    
    def __init__(self, spec: dict, code_dir: str):
        self.spec = spec
        self.code_dir = code_dir
    
    def check(self) -> List[SyncIssue]:
        issues = []
        
        # 1. 检查模型字段
        issues.extend(self._check_models())
        
        # 2. 检查 API 路由
        issues.extend(self._check_routes())
        
        # 3. 检查测试覆盖
        issues.extend(self._check_tests())
        
        return issues
    
    def _check_models(self) -> List[SyncIssue]:
        """检查模型定义是否一致"""
        issues = []
        
        for model_name, model_spec in self.spec["models"].items():
            model_file = self._find_model_file(model_name)
            if not model_file:
                issues.append(SyncIssue(
                    type="missing_model",
                    message=f"模型 {model_name} 未实现",
                ))
                continue
            
            # 解析代码中的字段
            code_fields = self._parse_model_fields(model_file)
            spec_fields = set(model_spec["fields"].keys())
            
            # 检查缺失字段
            missing = spec_fields - code_fields
            if missing:
                issues.append(SyncIssue(
                    type="missing_fields",
                    message=f"模型 {model_name} 缺少字段: {missing}",
                ))
            
            # 检查多余字段
            extra = code_fields - spec_fields
            if extra:
                issues.append(SyncIssue(
                    type="extra_fields",
                    message=f"模型 {model_name} 有未定义字段: {extra}",
                ))
        
        return issues
```

## CI/CD 集成

### GitHub Actions 配置

```yaml
# .github/workflows/spec-check.yml
name: Spec Validation

on:
  push:
    paths:
      - 'spec/**'
      - 'src/**'
  pull_request:
    paths:
      - 'spec/**'
      - 'src/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install spec-kit pyyaml jsonschema
      
      - name: Validate Spec
        run: |
          spec-kit validate spec/
      
      - name: Check Sync
        run: |
          spec-kit sync-check --spec spec/ --code src/
      
      - name: Generate Diff Report
        if: github.event_name == 'pull_request'
        run: |
          spec-kit diff --base origin/main --head HEAD > diff-report.md
          cat diff-report.md >> $GITHUB_STEP_SUMMARY
```

## 最佳实践

### 1. Spec 优先开发

```
1. 需求评审 → 产出 Spec 初稿
2. 技术评审 → 完善 Spec 细节
3. AI 生成 → 生成代码骨架
4. 人工完善 → 补充业务逻辑
5. 测试验证 → 基于 Spec 测试用例
6. 持续同步 → Spec 与代码保持一致
```

### 2. 渐进式采用

```python
# 阶段1：只用 Spec 定义 API 契约
apis:
  getUser:
    method: GET
    path: /users/{id}
    # ...

# 阶段2：添加数据模型
models:
  User:
    fields:
      # ...

# 阶段3：添加业务规则
rules:
  user:
    - name: unique_email
      # ...

# 阶段4：添加测试用例
tests:
  getUser:
    - name: success
      # ...
```

### 3. Spec 版本管理

```yaml
meta:
  version: 2.0.0
  changelog:
    - version: 2.0.0
      date: 2025-01-07
      changes:
        - "新增订单取消功能"
        - "用户状态增加 suspended 类型"
        - "破坏性变更: 移除 deprecated 的 v1 API"
    - version: 1.1.0
      date: 2024-12-01
      changes:
        - "新增批量查询接口"
```

## 工具生态

| 工具 | 用途 |
|------|------|
| `spec-kit validate` | 验证 Spec 语法和一致性 |
| `spec-kit generate` | 从 Spec 生成代码 |
| `spec-kit sync-check` | 检查代码与 Spec 同步状态 |
| `spec-kit diff` | 对比 Spec 变更 |
| `spec-kit mock` | 基于 Spec 启动 Mock 服务 |
| `spec-kit docs` | 生成 API 文档 |

## 总结

Spec Kit 实践的核心价值：

1. **需求即代码** - Spec 是可执行的需求文档
2. **AI 增强** - 利用 LLM 提升代码生成质量
3. **一致性保障** - 自动化检查确保代码与规格同步
4. **协作效率** - 产品、开发、测试基于同一份 Spec 协作

这种开发范式特别适合：
- API 密集型后端服务
- 需要严格契约的微服务架构
- 希望提升 AI 辅助编程效果的团队

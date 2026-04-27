---
slug: cross-page-sorting-consistency
title: 跨页排序一致性：Redis ZSet 快照 + ES 搜索 + JPA 三种方案实战
authors: [kanelli]
tags: [后端, 架构设计, Redis, ElasticSearch, Go, 排序]
keywords: [跨页排序, Redis ZSet, ElasticSearch, Spring Data JPA, 分页一致性, 快照机制]
---

在分页列表中，用户翻页时看到重复数据或数据丢失，是后端分页排序最常见也最隐蔽的 bug。本文将从排行榜、搜索、管理后台三个典型场景出发，分享三种不同的跨页排序一致性方案。

{/* truncate */}

## 问题：跨页排序为什么会出错？

典型场景：用户在排行榜页面浏览第 1 页时，后台分数实时更新。当用户翻到第 2 页时，排序顺序已经变化，导致：

- **数据重复**：某条目从第 2 页升到第 1 页，但用户已经翻过第 1 页，第 2 页仍然能看到它
- **数据遗漏**：某条目从第 1 页掉到第 2 页，但用户刚好翻过去了

核心矛盾：**排序依据在分页过程中发生了变化**。

## 架构总览

针对不同业务场景，可以在三条独立的技术链路上各自解决跨页排序问题：

```
┌──────────────────────────────────────────────────┐
│                    Frontend                       │
│                                                  │
│  排行榜页面        搜索页面       管理后台         │
│  (enterTime)     (sort enum)   (column sort)     │
└─────┬──────────────┬─────────────┬───────────────┘
      │              │             │
      ▼              ▼             ▼
┌───────────┐ ┌───────────┐ ┌───────────────┐
│ Go + Redis │ │ Go + ES   │ │ Kotlin + JPA  │
│ ZSet 快照   │ │ 搜索排序   │ │ Spring Data   │
│ (方案 1)   │ │ (方案 2)   │ │  (方案 3)     │
└───────────┘ └───────────┘ └───────────────┘
```

## 方案 1：排行榜系统 — Redis ZSet 快照

这是三种方案中最精巧的一种，专门为解决跨页一致性而设计。

### 核心思路

1. **全量预计算**：定时任务重新计算所有条目的分数，写入 Redis Sorted Set
2. **快照冻结**：每次更新完成后，将当前 ZSet 复制一份作为"快照"
3. **按快照分页**：前端在进入页面时记录一个时间戳 `enterTime`，后端根据这个时间戳找到对应快照，从快照中分页读取

这样，无论实时数据怎么变化，同一个用户的整个翻页过程都在同一份快照上操作。

### 前端：固定时间戳

```tsx
// 进入页面时固定时间戳
const enterTime = Math.floor(Date.now() / 1000);

const getRankingList = async (timestamp: number, page: number) => {
  const res = await fetchRanking({ timestamp, page, size: PAGE_SIZE });
  // ...
};

// 翻页时始终传同一个 enterTime
const handleScroll = () => {
  if (isNearBottom && hasMore) {
    getRankingList(enterTime, currentPage + 1);
  }
};
```

接口定义中需要明确注释强调这一点：

```protobuf
message GetRankingReq {
  int32  page      = 1;
  int32  size      = 2;
  int64  timestamp = 3;  // 翻页时必须保持时间戳一致，否则可能会有分页数据错漏问题
}
```

### 后端：快照机制

**快照创建** — 每次全量更新后执行：

```go
func (r *Rankings) UpdateAll(ctx context.Context) error {
    // 1. 重新计算所有条目的分数
    for _, item := range allItems {
        score := r.algo.Calculate(ctx, item)
        r.store.AddScoreToSortedSet(ctx, liveKey, item.ID, score)
    }
    // 2. 创建快照
    return r.CreateSnapshot(ctx)
}

func (r *Rankings) CreateSnapshot(ctx context.Context) error {
    snapshotKey := r.key + ":" + floorTime(time.Now())
    return r.store.CopySortedSet(ctx, r.key, snapshotKey)
}
```

**快照复制** — 使用 Lua 脚本保证原子性：

```lua
-- 原子复制 ZSet + 关联的 Hash
local src_zset = KEYS[1]
local dst_zset = KEYS[2]
local ttl = ARGV[1]

-- 通过 ZUNIONSTORE 复制 ZSet（权重=1，等同于拷贝）
redis.call('ZUNIONSTORE', dst_zset, 1, src_zset)
redis.call('EXPIRE', dst_zset, ttl)

-- 通过 DUMP/RESTORE 复制关联的 Hash（分数详情缓存）
local src_hash = src_zset .. ':scores'
local dst_hash = dst_zset .. ':scores'
local dump = redis.call('DUMP', src_hash)
if dump then
    redis.call('RESTORE', dst_hash, ttl * 1000, dump, 'REPLACE')
end
```

**按快照分页读取**：

```go
func (r *Rankings) Get(ctx context.Context, timestamp int64, page, size int) (*RankingResult, error) {
    // 根据前端传来的 timestamp 定位快照 key
    snapshotKey := r.key + ":" + floorTime(time.Unix(timestamp, 0))

    // 从快照中读取指定页
    ids, count, scores, err := r.store.GetSortedRange(
        ctx, snapshotKey,
        int64(page*size),        // offset
        int64(page*size+size-1), // limit
    )

    // 如果快照为空（过期或未创建），fallback 到实时数据
    if count == 0 {
        ids, count, scores, err = r.store.GetSortedRange(
            ctx, r.key, int64(page*size), int64(page*size+size-1),
        )
    }
    return &RankingResult{IDs: ids, Total: count, Scores: scores}, nil
}
```

### 热度算法示例

排行榜的分数通常不是简单计数，而是一个带时间衰减的热度公式：

```go
func (h *Hot) Calculate(ctx context.Context, r Record) float64 {
    weighted := float64(r.GetViews())*h.weights.View +
                float64(r.GetComments())*h.weights.Comment +
                float64(r.GetForks())*h.weights.Fork +
                float64(r.GetLikes())*h.weights.Like

    daysSinceCreation := time.Since(r.GetCreatedDate()).Hours() / 24
    decayFactor := math.Pow(daysSinceCreation+2, h.lambda) // lambda=0.6

    return (float64(r.GetInitialHeat()) + weighted) / decayFactor
}
```

公式的设计意图：**新条目有初始热度加成，互动行为按权重累加，时间衰减确保老条目不会永远霸榜**。

### 存储层接口

```go
type SortedSetStore interface {
    GetSortedRange(ctx context.Context, key string, start, stop int64) ([]string, int64, map[string]float64, error)
    AddScoreToSortedSet(ctx context.Context, key, id string, score float64) error
    CopySortedSet(ctx context.Context, src, dst string) error
}
```

Redis 实现中，`GetSortedRange` 使用 `ZREVRANGE` 做降序范围查询，`ZCARD` 获取总数。

## 方案 2：ES 搜索排序 + 分页

搜索页面的排序由 ElasticSearch 原生能力驱动。

### 前端：排序切换重置页码

```tsx
const sortOptions = [
  { value: 'BEST_MATCH', label: '最佳匹配' },
  { value: 'TRENDING', label: '最热' },
  { value: 'RECENTLY_CREATED', label: '最新' },
  { value: 'MOST_LIKES', label: '最多点赞' },
];

// 关键：排序变化时重置到第 0 页
useEffect(() => {
  setPage(0);
  fetchResults({ keyword: query, sort, page: 0, size: PAGE_SIZE });
}, [query, sort]);
```

### 后端：白名单映射防注入

Go 后端维护一个排序语句白名单，将前端枚举值映射为 ES 排序表达式：

```go
var sortStatement = map[string]string{
    "BEST_MATCH":       "_score",
    "TRENDING":         "hot:desc",
    "RECENTLY_CREATED": "createdDate:desc",
    "MOST_LIKES":       "likes:desc",
}

func (s *Store) Search(ctx context.Context, keyword, sort string, from, size int) (*Result, error) {
    sortExpr, ok := sortStatement[sort]
    if !ok {
        sortExpr = "_score" // 默认按相关性
    }
    query := buildQuery(keyword, sortExpr, from, size)
    return s.client.Search(ctx, query)
}
```

ES 查询模板使用 `from/size` 分页：

```json
{
  "from": "{{.From}}",
  "size": "{{.Size}}",
  "sort": ["{{.Sort}}"],
  "query": {
    "bool": {
      "must": {
        "multi_match": {
          "query": "{{.Keyword}}",
          "fields": ["name^3", "description", "tags"]
        }
      }
    }
  }
}
```

### 跨页一致性分析

ES 的 `from/size` 分页本质上是**无状态深分页**，每次查询都会重新排序。这意味着：

- **搜索场景可以接受轻微不一致**：搜索结果本身就是动态的，用户对此有预期
- **不适合超大数据量的深分页**：ES 默认限制 `from + size ≤ 10000`
- **白名单映射保证了安全性**：不可能通过前端参数注入任意排序表达式

## 方案 3：Spring Data JPA 标准分页

管理后台场景下，使用 Spring Data JPA 的标准分页排序即可。

### Controller 层

```kotlin
@GetMapping("/list")
fun list(
    @RequestParam pageNumber: Int,
    @RequestParam pageSize: Int
): Page<Item> {
    val pageable = PageRequest.of(
        pageNumber, pageSize,
        Sort.by(Sort.Direction.DESC, "lastModifiedDate")
    )
    return itemService.findAll(pageable)
}
```

### 排序 + 分页 → SQL

Spring Data JPA 会将 `PageRequest.of(page, size, Sort.by(...))` 转换为：

```sql
SELECT * FROM item
ORDER BY last_modified_date DESC
LIMIT :size OFFSET :page * :size
```

### 管理后台的列排序

Admin 前端使用 Ant Design Table 的列排序能力：

```tsx
const columns = [
  {
    title: '使用时长',
    dataIndex: 'useTime',
    sorter: true,  // 启用服务端排序
  },
  // ...
];

const onSortChange = (pagination, _filters, sorter) => {
  const sortData = sorter.columnKey && sorter.order
    ? `${sorter.columnKey},${sorter.order === 'descend' ? 'desc' : 'asc'}`
    : '';
  fetchData({ sort: sortData, page: pagination.current });
};
```

排序参数以 `columnKey,asc/desc` 格式传给后端，后端通过 Spring Data 的 `Sort.by()` 解析。

### 跨页一致性分析

JPA 的 `OFFSET/LIMIT` 分页同样是无状态的。在管理后台场景下，数据变更频率低，这种方式足够实用。

## 三种方案对比

| 维度 | 方案 1：Redis ZSet 快照 | 方案 2：ES 搜索 | 方案 3：Spring Data JPA |
|------|------------------------|----------------|----------------------|
| **适用场景** | 排行榜（热度/活跃度） | 关键词搜索 | 管理后台列表 |
| **排序驱动** | 预计算分数写入 ZSet | ES `_score` / 字段排序 | SQL `ORDER BY` |
| **分页方式** | `ZREVRANGE start stop` | `from` / `size` | `LIMIT` / `OFFSET` |
| **跨页一致性** | ✅ 快照保证强一致 | ❌ 无状态，每次重新排序 | ❌ 无状态，每次重新排序 |
| **深分页性能** | O(log N + M) 高效 | 受 `max_result_window` 限制 | OFFSET 大时性能差 |
| **实时性** | 快照间隔内有延迟 | 接近实时（ES refresh） | 实时 |
| **安全性** | Key 由后端构造 | 白名单映射 | Spring Data 参数绑定 |

## 关键设计洞察

### 1. 快照 Key 的时间对齐

```go
snapshotKey := r.key + ":" + floorTime(time.Unix(timestamp, 0))
```

`floorTime()` 将时间戳向下对齐到最近的快照时间点。这意味着：
- 不需要为每个用户创建独立快照
- 同一个时间窗口内的所有用户共享同一份快照
- 快照数量可控，不会随用户量膨胀

### 2. Lua 脚本保证原子性

快照创建使用 Lua 脚本在 Redis 服务端原子执行 `ZUNIONSTORE` + `DUMP/RESTORE`。如果使用多条 Redis 命令，在高并发下可能出现半成品快照。

### 3. 防御性 Fallback

当快照不存在或过期时，自动降级到实时数据。这保证了：
- 系统启动初期（无快照时）仍可用
- 快照过期后不会返回空数据
- 以一致性换可用性，符合排行榜场景的需求

### 4. 排序参数从不信任前端

三种方案都没有直接使用前端传来的排序表达式：
- **方案 1**：排序完全由后端预计算决定，前端只传时间戳和页码
- **方案 2**：白名单映射，非法枚举值 fallback 到默认排序
- **方案 3**：Spring Data 的 `Sort.by()` 使用参数绑定，不存在 SQL 注入风险

## 总结

跨页排序不需要追求"大一统"方案，根据业务场景选择合适的技术即可：

- **需要强一致性的排行榜** → Redis ZSet + 时间窗口快照，前端锁定 `enterTime`
- **搜索场景** → ES 原生排序 + 白名单映射，接受轻微不一致
- **管理后台** → Spring Data JPA 标准分页，简单直接

其中最值得借鉴的是**方案 1 的快照机制**。它用一种低成本的方式（定时 `ZUNIONSTORE`）解决了实时排序系统中最棘手的跨页一致性问题，而不需要引入 Scroll API 或 Search After 等更复杂的方案。这个思路可以推广到任何需要"用户在翻页过程中看到一致数据"的场景。

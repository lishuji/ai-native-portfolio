// src/pages/index.tsx
import Link from '@docusaurus/Link';
import styles from './index.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      {/* Hero 区 */}
      <section className={styles.hero}>
        <h1>Kanelli｜Backend & AI Engineer</h1>
        <p>10年后端经验 | Go / Java / PHP | 高并发系统 | LLM & AI Agent</p>
        <div className={styles.heroButtons}>
          <Link className={styles.button} to="/docs/ai-native/agent-design">
            查看技术文档
          </Link>
        </div>
      </section>

      {/* 能力亮点区 */}
      <section className={styles.skills}>
        <h2>核心能力</h2>
        <div className={styles.skillList}>
          <div className={styles.skillItem}>
            <h3>高并发系统</h3>
            <p>分布式设计、MQ削峰、Redis Lua 幂等</p>
          </div>
          <div className={styles.skillItem}>
            <h3>AI 工程</h3>
            <p>LLM 应用开发、AI Agent、Spec-Kit 实战</p>
          </div>
          <div className={styles.skillItem}>
            <h3>数据库优化</h3>
            <p>MySQL / Redis / Elasticsearch 调优</p>
          </div>
        </div>
      </section>

      {/* 核心项目区 */}
      <section className={styles.projects}>
        <h2>核心项目</h2>
        <div className={styles.projectList}>
          <Link className={styles.projectItem} to="/docs/architecture/high-concurrency">
            <h3>高并发订单系统</h3>
            <p>分布式架构 + Redis Lua 幂等 + MQ 削峰</p>
            <span>峰值 RT ↓ 63%，错误率 &lt; 0.01%</span>
          </Link>
          <Link className={styles.projectItem} to="/docs/ai-native/agent-design">
            <h3>AI Agent 平台</h3>
            <p>LLM Agent 平台，支持多任务自动化</p>
            <span>ReAct / Plan-Execute / Multi-Agent</span>
          </Link>
          <Link className={styles.projectItem} to="/docs/architecture/distributed-lock">
            <h3>分布式锁实战</h3>
            <p>解决库存一致性和幂等问题</p>
            <span>Redis / etcd / 数据库锁方案对比</span>
          </Link>
        </div>
      </section>

      {/* 技术方法论区 */}
      <section className={styles.architecture}>
        <h2>技术方法论</h2>
        <p>架构设计、性能优化、稳定性提升、工程化落地</p>
        <Link className={styles.button} to="/docs/architecture/high-concurrency">
          查看方法论
        </Link>
      </section>

      {/* 联系方式 */}
      <section className={styles.contact}>
        <h2>联系我</h2>
        <p>Email: kanelli@example.com</p>
        <p>GitHub: <a href="https://github.com/kanelli" target="_blank" rel="noopener noreferrer">github.com/kanelli</a></p>
      </section>
    </div>
  );
}

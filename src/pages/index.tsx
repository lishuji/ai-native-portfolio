import Link from '@docusaurus/Link';
import styles from './index.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      {/* Hero 区 */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>Kanelli</h1>
          <p className={styles.heroSubtitle}>
            Backend & AI Engineer | 10年后端经验
          </p>
          <div className={styles.heroTags}>
            <span className={styles.heroTag}>Go / Java / PHP</span>
            <span className={styles.heroTag}>高并发系统</span>
            <span className={styles.heroTag}>LLM & AI Agent</span>
            <span className={styles.heroTag}>分布式架构</span>
          </div>
          <div className={styles.heroButtons}>
            <Link className={styles.buttonPrimary} to="/docs/ai-native/agent-design">
              查看技术文档
            </Link>
            <a
              className={styles.buttonSecondary}
              href="https://github.com/lishuji"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* 能力亮点区 */}
      <section className={styles.skills}>
        <h2 className={styles.sectionTitle}>核心能力</h2>
        <div className={styles.skillList}>
          <Link className={styles.skillItem} to="/docs/architecture/high-concurrency">
            <div className={styles.skillIcon}>⚡</div>
            <h3>高并发系统</h3>
            <p>分布式设计、MQ 削峰、Redis Lua 幂等、百万级 QPS 实战经验</p>
          </Link>
          <Link className={styles.skillItem} to="/docs/ai-native/agent-design">
            <div className={styles.skillIcon}>🤖</div>
            <h3>AI 工程</h3>
            <p>LLM 应用开发、AI Agent 设计、RAG 系统、Prompt Engineering</p>
          </Link>
          <Link className={styles.skillItem} to="/docs/architecture/data-modeling">
            <div className={styles.skillIcon}>🗄️</div>
            <h3>数据库优化</h3>
            <p>MySQL 调优、Redis 集群、分库分表、Elasticsearch 搜索优化</p>
          </Link>
          <Link className={styles.skillItem} to="/docs/architecture/system-evolution">
            <div className={styles.skillIcon}>☁️</div>
            <h3>云原生</h3>
            <p>Kubernetes 部署、Service Mesh、可观测性、DevOps 实践</p>
          </Link>
        </div>
      </section>

      {/* 核心项目区 */}
      <section className={styles.projects}>
        <h2 className={styles.sectionTitle}>核心项目</h2>
        <div className={styles.projectList}>
          <Link className={styles.projectItem} to="/docs/architecture/high-concurrency">
            <h3>高并发订单系统</h3>
            <p>分布式架构 + Redis Lua 幂等 + Kafka 削峰，支撑百万级订单处理</p>
            <span className={styles.projectMeta}>峰值 RT ↓ 63%，错误率 &lt; 0.01%</span>
          </Link>
          <Link className={styles.projectItem} to="/docs/ai-native/agent-design">
            <h3>AI Agent 平台</h3>
            <p>基于 LLM 的智能 Agent 平台，支持多任务自动化和工具调用</p>
            <span className={styles.projectMeta}>ReAct / Plan-Execute / Multi-Agent</span>
          </Link>
          <Link className={styles.projectItem} to="/docs/architecture/distributed-lock">
            <h3>分布式锁实战</h3>
            <p>解决高并发场景下的库存一致性和接口幂等问题</p>
            <span className={styles.projectMeta}>Redis / etcd / 数据库锁方案对比</span>
          </Link>
        </div>
      </section>

      {/* 技术方法论区 */}
      <section className={styles.architecture}>
        <h2>技术方法论</h2>
        <p>架构设计、性能优化、稳定性提升、工程化落地</p>
        <div className={styles.archList}>
          <div className={styles.archItem}>
            <span>10+</span>
            <p>年后端经验</p>
          </div>
          <div className={styles.archItem}>
            <span>100万+</span>
            <p>日订单处理</p>
          </div>
          <div className={styles.archItem}>
            <span>99.99%</span>
            <p>系统可用性</p>
          </div>
        </div>
        <Link className={styles.buttonPrimary} to="/docs/architecture/system-evolution">
          查看方法论
        </Link>
      </section>

      {/* 联系方式 */}
      <section className={styles.contact}>
        <h2>联系我</h2>
        <div className={styles.contactLinks}>
          <a className={styles.contactLink} href="mailto:lishuji2547@gmail.com">
            📧 lishuji2547@gmail.com
          </a>
          <a
            className={styles.contactLink}
            href="https://github.com/lishuji"
            target="_blank"
            rel="noopener noreferrer"
          >
            🐙 GitHub
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        © 2024 Kanelli. Built with Docusaurus.
      </footer>
    </div>
  );
}

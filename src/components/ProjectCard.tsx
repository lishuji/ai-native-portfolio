import React, { useState } from 'react';
import styles from './ProjectCard.module.css';

interface ProjectCardProps {
  title: string;
  description: string;
  demo?: React.ReactNode;
  link: string;
}

export default function ProjectCard({ title, description, demo, link }: ProjectCardProps) {
  const [showDemo, setShowDemo] = useState(false);

  return (
    <div className={styles.card}>
      <h3>{title}</h3>
      <p>{description}</p>
      {demo && (
        <>
          <button onClick={() => setShowDemo(!showDemo)} className={styles.demoBtn}>
            {showDemo ? '隐藏 Demo' : '展示 Demo'}
          </button>
          {showDemo && <div className={styles.demo}>{demo}</div>}
        </>
      )}
      <a href={link} target="_blank" className={styles.detailLink}>
        查看详情
      </a>
    </div>
  );
}

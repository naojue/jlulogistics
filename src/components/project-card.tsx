import Link from "next/link";
import { ArrowUpRight, Code2 } from "lucide-react";
import { date } from "@/lib/utils";

export type ProjectCardItem = {
  id: string;
  title: string;
  description: string;
  course: string;
  tags: string;
  author: { name: string };
  createdAt: Date;
};

export function ProjectCard({ item }: { item: ProjectCardItem }) {
  return (
    <Link className="resource-card project-card" href={`/projects/${item.id}`}>
      <div className="resource-card-top">
        <div className="project-card-icon">
          <Code2 size={25} />
        </div>
        <span className="badge badge-member">{item.course}</span>
      </div>
      <h3>{item.title}</h3>
      <p className="card-description">{item.description}</p>
      <div className="tag-list">
        {item.tags
          .split(",")
          .filter(Boolean)
          .slice(0, 4)
          .map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
      </div>
      <div className="resource-card-footer">
        <span className="avatar avatar-small">{item.author.name.slice(0, 1)}</span>
        <span>{item.author.name}</span>
      </div>
      <div className="resource-card-date">
        <span>{date(item.createdAt)}</span>
        <ArrowUpRight size={15} />
      </div>
    </Link>
  );
}

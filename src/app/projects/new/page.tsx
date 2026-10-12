import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { memberPage } from "@/lib/session";
import { projectStorageConfigured } from "@/services/projects";
import { PageHeading } from "@/components/common";
import { ProjectUploadForm } from "@/components/project-upload-form";

export default async function NewProject() {
  await memberPage();
  return (
    <div className="narrow">
      <Link className="back-link" href="/projects">
        <ArrowLeft size={15} />
        返回项目库
      </Link>
      <PageHeading
        eyebrow="TURN IDEAS INTO PROJECTS"
        title="发布专业项目"
        description="介绍问题和成果，上传项目 ZIP，让伙伴们一起阅读、提问和改进。"
      />
      <section className="panel">
        <ProjectUploadForm configured={projectStorageConfigured()} />
      </section>
    </div>
  );
}

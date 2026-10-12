"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMember } from "@/lib/session";
import { AppError } from "@/lib/policy";
import {
  updateProject,
  removeProject,
  retryProject,
  removeProjectComment,
} from "@/services/projects";
import type { ActionResult } from "@/app/actions";
const field = (form: FormData, name: string) => String(form.get(name) || "");
async function run(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message || "请检查项目内容" };
    return { error: "操作失败，请稍后重试" };
  }
}
export async function updateProjectAction(form: FormData) {
  return run(async () => {
    const id = field(form, "id");
    await updateProject(await requireMember(), id, {
      title: field(form, "title"),
      description: field(form, "description"),
      course: field(form, "course"),
      tags: field(form, "tags"),
    });
    return { id, success: "项目介绍已更新" };
  });
}
export async function deleteProjectAction(form: FormData) {
  return run(async () => {
    await removeProject(await requireMember(), field(form, "id"), field(form, "reason"));
    return { success: "项目已删除" };
  });
}
export async function retryProjectAction(form: FormData) {
  return run(async () => {
    await retryProject(await requireMember(), field(form, "id"));
    return { success: "已重新加入同步队列" };
  });
}
export async function deleteProjectCommentAction(form: FormData) {
  return run(async () => {
    await removeProjectComment(await requireMember(), field(form, "id"), field(form, "reason"));
    return { success: "留言已删除" };
  });
}

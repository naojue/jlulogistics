"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireMember, requireAdmin, requireSuper } from "@/lib/session";
import { AppError } from "@/lib/policy";
import { emailSchema, nameSchema } from "@/lib/validation";
import { reviewMember, resubmitApplication, setAdministrator } from "@/services/members";
import { createInvitation, hashToken, redeemInvitation } from "@/services/invitations";
import { updateResource, removeResource } from "@/services/resources";
import { publishPost, updatePost, addDiscussion, removeDiscussion } from "@/services/discussions";

export type ActionResult = {
  success?: string;
  error?: string;
  id?: string;
  token?: string;
  url?: string;
};
async function run(callback: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const result = await callback();
    revalidatePath("/", "layout");
    return result;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message || "填写内容无效" };
    if (error && typeof error === "object" && "code" in error && error.code === "P2002")
      return { error: "这个名称已经存在" };
    console.error("Action failed", error instanceof Error ? error.message : "unknown");
    return { error: "操作失败，请刷新后重试" };
  }
}
const field = (form: FormData, name: string) => String(form.get(name) || "");
export async function resubmitAction(form: FormData) {
  return run(async () => {
    await resubmitApplication(await requireUser(), field(form, "statement"));
    return { success: "申请已重新提交" };
  });
}
export async function profileAction(form: FormData) {
  return run(async () => {
    const actor = await requireUser();
    const name = nameSchema.parse(field(form, "name"));
    await db.user.update({ where: { id: actor.id }, data: { name } });
    return { success: "昵称已更新" };
  });
}
export async function reviewAction(form: FormData) {
  return run(async () => {
    await reviewMember(
      await requireAdmin(),
      field(form, "id"),
      field(form, "decision"),
      field(form, "reason"),
    );
    return { success: "成员状态已更新" };
  });
}
export async function adminRoleAction(form: FormData) {
  return run(async () => {
    await setAdministrator(
      await requireSuper(),
      field(form, "id"),
      field(form, "promote") === "true",
    );
    return { success: "管理员权限已更新，用户需重新登录" };
  });
}
export async function invitationAction(form: FormData) {
  return run(async () => {
    const invitation = await createInvitation(
      await requireSuper(),
      emailSchema.parse(field(form, "email")),
      field(form, "deliver") === "true",
    );
    return {
      success: invitation.warning || "管理员邀请已创建，请保存邀请码",
      token: invitation.token,
      url: invitation.url,
    };
  });
}
export async function revokeInvitationAction(form: FormData) {
  return run(async () => {
    const actor = await requireSuper();
    const id = field(form, "id");
    await db.$transaction(async (tx) => {
      const changed = await tx.adminInvitation.updateMany({
        where: { id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!changed.count) throw new AppError("邀请不存在或已处理");
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "REVOKE_ADMIN_INVITATION", targetId: id },
      });
    });
    return { success: "邀请已撤销" };
  });
}
export async function redeemInvitationAction(form: FormData) {
  return run(async () => {
    await redeemInvitation((await requireUser()).id, hashToken(field(form, "token")));
    return { success: "管理员邀请已激活，请刷新页面" };
  });
}
export async function resourceEditAction(form: FormData) {
  return run(async () => {
    const id = field(form, "id");
    await updateResource(await requireMember(), id, {
      title: field(form, "title"),
      description: field(form, "description"),
      area: field(form, "area"),
      categoryId: field(form, "categoryId"),
      tagIds: form.getAll("tagIds").map(String),
    });
    return { success: "资料信息已更新", id };
  });
}
export async function resourceDeleteAction(form: FormData) {
  return run(async () => {
    await removeResource(await requireMember(), field(form, "id"), field(form, "reason"));
    return { success: "资料已删除" };
  });
}
export async function postAction(form: FormData) {
  return run(async () => {
    const actor = await requireMember();
    const data = {
      title: field(form, "title"),
      body: field(form, "body"),
      categoryId: field(form, "categoryId"),
    };
    const id = field(form, "id");
    if (id) {
      await updatePost(actor, id, data);
      return { success: "帖子已更新", id };
    }
    const post = await publishPost(actor, data);
    return { success: "帖子已发布", id: post.id };
  });
}
export async function commentAction(form: FormData) {
  return run(async () => {
    const kind = z.enum(["RESOURCE", "POST"]).parse(field(form, "kind"));
    await addDiscussion(
      await requireMember(),
      kind,
      field(form, "id"),
      field(form, "body"),
      field(form, "parentId") || undefined,
    );
    return { success: "留言已发布" };
  });
}
export async function discussionDeleteAction(form: FormData) {
  return run(async () => {
    await removeDiscussion(
      await requireMember(),
      z.enum(["POST", "COMMENT", "REPLY"]).parse(field(form, "kind")),
      field(form, "id"),
      field(form, "reason"),
    );
    return { success: "内容已删除" };
  });
}
export async function taxonomyAction(form: FormData) {
  return run(async () => {
    const actor = await requireAdmin();
    const kind = z.enum(["RESOURCE", "POST", "TAG"]).parse(field(form, "kind"));
    const name = z.string().trim().min(1, "请输入名称").max(30).parse(field(form, "name"));
    const id = field(form, "id");
    await db.$transaction(async (tx) => {
      let targetId = id;
      if (kind === "TAG") {
        const item = id
          ? await tx.tag.update({ where: { id }, data: { name } })
          : await tx.tag.create({ data: { name } });
        targetId = item.id;
      } else {
        if (id) {
          const category = await tx.category.findUnique({ where: { id } });
          if (category?.kind !== kind) throw new AppError("分类类型无效");
        }
        const item = id
          ? await tx.category.update({ where: { id }, data: { name } })
          : await tx.category.create({ data: { name, kind } });
        targetId = item.id;
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: id ? "EDIT_TAXONOMY" : "CREATE_TAXONOMY",
          targetId,
          reason: name,
        },
      });
    });
    return { success: "分类或标签已保存" };
  });
}
export async function taxonomyDeleteAction(form: FormData) {
  return run(async () => {
    const actor = await requireAdmin();
    const id = field(form, "id");
    const kind = field(form, "kind");
    await db.$transaction(async (tx) => {
      if (kind === "TAG") {
        if (await tx.resource.count({ where: { tags: { some: { id } } } }))
          throw new AppError("该标签已被使用，请先移除资料关联");
        await tx.tag.delete({ where: { id } });
      } else {
        const category = await tx.category.findUnique({ where: { id } });
        if (!category || category.kind !== kind) throw new AppError("分类不存在");
        if (
          (await tx.resource.count({ where: { categoryId: id } })) ||
          (await tx.post.count({ where: { categoryId: id } }))
        )
          throw new AppError("该分类已被使用，请先调整内容分类");
        await tx.category.delete({ where: { id } });
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "DELETE_TAXONOMY", targetId: id },
      });
    });
    return { success: "分类或标签已删除" };
  });
}

import { z } from "zod";
z.config(z.locales.zhCN());
export const emailSchema = z.email("请输入有效邮箱").transform((v) => v.trim().toLowerCase());
export const statementSchema = z
  .string()
  .trim()
  .min(10, "申请说明至少 10 个字")
  .max(1000, "申请说明最多 1000 个字");
export const nameSchema = z.string().trim().min(2, "昵称至少 2 个字").max(30, "昵称最多 30 个字");
export const resourceSchema = z.object({
  title: z.string().trim().min(2, "标题至少 2 个字").max(120, "标题最多 120 个字"),
  description: z.string().trim().min(10, "简介至少 10 个字").max(3000, "简介最多 3000 个字"),
  area: z.enum(["MEMBER", "ADMIN"]),
  categoryId: z.string().min(1, "请选择分类"),
  tagIds: z.array(z.string()).max(10, "最多选择 10 个标签"),
});
export const postSchema = z.object({
  title: z.string().trim().min(2, "标题至少 2 个字").max(120),
  body: z.string().trim().min(10, "正文至少 10 个字").max(20000),
  categoryId: z.string().min(1, "请选择分类"),
});
export const commentSchema = z.string().trim().min(1, "请输入内容").max(3000, "内容最多 3000 个字");
export const reasonSchema = z.string().trim().min(2, "请填写至少 2 个字的原因").max(500);

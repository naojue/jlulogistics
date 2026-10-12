import { describe, it, expect } from "vitest";
import {
  assertMember,
  assertArea,
  assertSuper,
  assertOwner,
  assertManageMember,
  invitationValid,
  type Actor,
} from "../src/lib/policy";
import {
  validateFilename,
  validSignature,
  storagePath,
  MAX_FILE_SIZE,
} from "../src/services/storage";
const member: Actor = {
  id: "member",
  role: "MEMBER",
  status: "ACTIVE",
  emailVerified: true,
  mustChangePassword: false,
};
describe("权限与文件边界", () => {
  it("匿名、待审批、未验证和停用用户不能使用成员功能", () => {
    for (const actor of [
      null,
      { ...member, status: "PENDING" },
      { ...member, status: "SUSPENDED" },
      { ...member, emailVerified: false },
      { ...member, mustChangePassword: true },
    ])
      expect(() => assertMember(actor)).toThrow();
    expect(() => assertMember(member)).not.toThrow();
  });
  it("篡改上传区参数不能越权", () => {
    expect(() => assertArea(member, "ADMIN")).toThrow();
    expect(() => assertArea(member, "MEMBER")).not.toThrow();
    expect(() => assertArea(member, "bogus")).toThrow();
  });
  it("普通管理员不能管理其他管理员或邀请管理员", () => {
    const admin = { ...member, role: "ADMIN" };
    expect(() => assertSuper(admin)).toThrow();
    expect(() => assertManageMember(admin, admin)).toThrow();
    expect(() => assertManageMember(admin, member)).not.toThrow();
  });
  it("成员只能管理自己的内容", () => {
    expect(() => assertOwner(member, "other")).toThrow();
    expect(() => assertOwner(member, member.id)).not.toThrow();
  });
  it("邀请码绑定邮箱且有期限、使用与撤销状态", () => {
    const invite = {
      email: "member@example.test",
      expiresAt: new Date(Date.now() + 10000),
      usedAt: null,
      revokedAt: null,
    };
    expect(invitationValid(invite, "MEMBER@example.test")).toBe(true);
    expect(invitationValid(invite, "other@example.test")).toBe(false);
    expect(invitationValid({ ...invite, expiresAt: new Date(0) }, invite.email)).toBe(false);
    expect(invitationValid({ ...invite, usedAt: new Date() }, invite.email)).toBe(false);
    expect(invitationValid({ ...invite, revokedAt: new Date() }, invite.email)).toBe(false);
  });
  it("禁止路径穿越、可执行格式和错误文件签名", () => {
    expect(MAX_FILE_SIZE).toBe(52428800);
    for (const file of ["../x.pdf", "x.exe", "x.svg", "a\\b.pdf"])
      expect(() => validateFilename(file)).toThrow();
    expect(() => storagePath("../secret")).toThrow();
    expect(validSignature("pdf", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(validSignature("pdf", Buffer.from("<script>"))).toBe(false);
    expect(validSignature("png", Buffer.from("not a png"))).toBe(false);
  });
});

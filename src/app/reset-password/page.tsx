import { AuthPage } from "@/components/auth-page";
import { AuthForm } from "@/components/auth-form";
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthPage
      title="设置新密码"
      description={
        token
          ? "修改后需要重新登录，旧会话将被撤销。"
          : "重置链接缺少令牌，请重新申请密码重置邮件。"
      }
    >
      <AuthForm mode="reset" token={token} />
    </AuthPage>
  );
}

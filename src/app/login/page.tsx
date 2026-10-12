import { AuthPage } from "@/components/auth-page";
import { AuthForm } from "@/components/auth-form";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthPage title="欢迎回来" description="登录你的账号，继续今天的学习。">
      {params.verified && <p className="form-success">邮箱已验证，请登录查看申请状态。</p>}
      {params.error && <p className="form-error">验证链接无效或已过期，请重新发送验证邮件。</p>}
      <AuthForm mode="login" />
    </AuthPage>
  );
}

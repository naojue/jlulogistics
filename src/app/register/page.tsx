import { AuthPage } from "@/components/auth-page";
import { AuthForm } from "@/components/auth-form";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; email?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthPage
      title={params.invite ? "接受管理员邀请" : "加入学习社区"}
      description={
        params.invite
          ? "设置账号并验证邮箱后，管理员邀请自动生效。"
          : "验证邮箱后，管理员会审核你的加入申请。"
      }
    >
      <AuthForm mode="register" invite={params.invite} email={params.email} />
    </AuthPage>
  );
}

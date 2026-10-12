import { AuthPage } from "@/components/auth-page";
import { AuthForm } from "@/components/auth-form";
export default function Forgot() {
  return (
    <AuthPage title="找回密码" description="输入注册邮箱，我们会发送密码重置链接。">
      <AuthForm mode="forgot" />
    </AuthPage>
  );
}

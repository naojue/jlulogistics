import { Network } from "lucide-react";
import { SupplyChainArt } from "@/components/supply-chain-art";
export function AuthPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell">
      <aside className="auth-intro">
        <Network size={34} className="auth-symbol" />
        <p className="eyebrow">JIDA LOGISTICS COMMUNITY</p>
        <h2>
          让知识有去处，
          <br />
          让学习有同伴。
        </h2>
        <p>
          一份整理好的资料，一次认真回答，
          <br />
          都能让另一个人的学习之路更轻松。
        </p>
        <SupplyChainArt />
      </aside>
      <section className="auth-content">
        <p className="eyebrow">WELCOME TO JIDA LOGISTICS</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
        {children}
      </section>
    </div>
  );
}

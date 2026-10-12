import { Boxes, GraduationCap, Network, Route } from "lucide-react";

export function SupplyChainArt() {
  return (
    <div className="supply-art" aria-hidden="true">
      <div className="supply-orbit supply-orbit-outer" />
      <div className="supply-orbit supply-orbit-inner" />
      <svg className="supply-path" viewBox="0 0 320 250" fill="none">
        <path d="M78 70 Q160 0 252 95 Q315 185 158 211 Q40 214 78 70Z" />
        <path d="M78 70 158 137 252 95M158 137 158 211" />
      </svg>
      <div className="supply-hub">
        <Network size={34} strokeWidth={1.4} />
      </div>
      <div className="supply-node supply-node-one">
        <Boxes size={24} strokeWidth={1.5} />
        <span>物流管理</span>
      </div>
      <div className="supply-node supply-node-two">
        <Route size={24} strokeWidth={1.5} />
        <span>供应链协同</span>
      </div>
      <div className="supply-node supply-node-three">
        <GraduationCap size={24} strokeWidth={1.5} />
        <span>知识共享</span>
      </div>
      <span className="supply-caption">连接知识，也连接彼此。</span>
    </div>
  );
}

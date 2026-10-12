import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="吉大物流 · 学习社区首页">
      <span className="brand-visual" aria-hidden="true">
        <span className="brand-mark" />
      </span>
      <span className="brand-caption">物流与供应链 · 学习社区</span>
    </Link>
  );
}

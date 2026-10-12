# 吉大物流网站品牌资产

通过内置 image_gen 工具从已选 v4 设计稿提取透明品牌图，保持供应链 JL 徽标和毛体风格字标。

部署资产：`public/brand/jida-logistics-v1.png`。界面使用 CSS alpha 遮罩着色，暗色光晕和闪光由 CSS 产生。

## 最终生成提示词

Use case: background-extraction.
Input image: edit target, accepted two-panel 吉大物流 logo.
Extract ONLY the complete horizontal logo from the TOP panel onto a truly transparent alpha background. Preserve EXACTLY the JL monogram with three hollow supply chain nodes and circular route, and the four Mao-style calligraphy characters 吉大物流. Preserve all silhouette details and relative proportions. Output ONE logo instance, solid uniform cobalt blue #365CA8. Crop closely around the entire logo, with only 3% transparent padding. Wide horizontal canvas about 4.2:1. Remove both panel backgrounds completely, remove the bottom repeated logo, and retain actual transparent empty spaces inside glyphs and icon. No new design. No glow, no gradients, no haze, no shadow, no background color. Sharp completely opaque blue strokes, transparent surroundings. Export asset for website header, not a presentation.

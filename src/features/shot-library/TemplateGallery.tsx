"use client";

/**
 * Development template gallery (Prompt 4 / Phase 1 Day 4).
 *
 * Displays ONLY templates the caller loaded through the explicit development
 * loader opt-in (engineering_ready today). Every card states the development
 * status plainly: DEVELOPMENT template, reviewStatus, and "not director
 * approved". Reference images are served from the local /reference-images
 * directory — never a remote URL, never a provider request.
 */
import type { ShotTemplate } from "@/domain/shot-template";

export interface TemplateGalleryProps {
  templates: readonly ShotTemplate[];
  selectedTemplateId: string | null;
  onSelect: (templateId: string) => void;
}

export function TemplateGallery({ templates, selectedTemplateId, onSelect }: TemplateGalleryProps) {
  return (
    <section className="template-gallery" data-testid="template-gallery" aria-label="模板库">
      <div className="template-gallery-header">
        <h2>选择对话镜头模板</h2>
        <p className="gallery-development-note" data-testid="gallery-development-note">
          DEVELOPMENT GALLERY — engineering_ready 模板，未获导演批准（not director
          approved）。正式画廊仅显示 approved 模板；当前数量为 0。
        </p>
      </div>
      <ul className="template-gallery-grid">
        {templates.map((template) => {
          const isSelected = template.id === selectedTemplateId;
          return (
            <li
              key={template.id}
              className="template-card"
              data-testid="template-card"
              data-template-id={template.id}
              data-selected={isSelected ? "true" : "false"}
            >
              <div className="template-card-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size
                    local development gallery; the Next image optimizer is not
                    wanted here and the source is always same-origin. */}
                <img
                  src={template.display.referenceImage}
                  alt={`${template.display.nameZh} 参考图`}
                  width={240}
                  height={135}
                  loading="eager"
                  decoding="sync"
                />
                <span className="template-card-badge-development">DEVELOPMENT</span>
              </div>
              <div className="template-card-body">
                <h3 className="template-card-name">{template.display.nameZh}</h3>
                <p className="template-card-purpose" data-testid="template-narrative-purpose">
                  {template.display.narrativePurposeZh}
                </p>
                <p className="template-card-effects">
                  情绪效果：{template.display.emotionalEffectsZh.join(" · ")}
                </p>
                <p className="template-card-meta" data-testid="template-meta">
                  <span className="template-card-id">
                    {template.id} v{template.version}
                  </span>
                  <span className="template-card-status" data-testid="template-review-status">
                    {template.reviewStatus} · not director approved
                  </span>
                </p>
                <button
                  type="button"
                  className="template-card-select"
                  data-testid={`select-template-${template.id}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(template.id)}
                >
                  {isSelected ? "当前模板（重新选择将创建新 ShotState）" : "使用此模板"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

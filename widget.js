(function () {
  "use strict";

  // ===========================================================================
  // SISGPI Book Builder v2.2.0 - SAC Custom Widget com Data Binding
  // ===========================================================================
  // Mapeamento de measures_N -> nome do indicador via:
  //   metadata.mainStructureMembers["measures_N"].label
  // Cada linha do data é 1 projeto + N medidas (N = qtde de Contas no Builder).
  // ===========================================================================

  const PDFLIB_CDN = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";

  let _pdfLibPromise = null;
  function loadPdfLib() {
    if (_pdfLibPromise) return _pdfLibPromise;
    _pdfLibPromise = new Promise((resolve, reject) => {
      if (window.PDFLib) { resolve(window.PDFLib); return; }
      const script = document.createElement("script");
      script.src = PDFLIB_CDN;
      script.onload = () => resolve(window.PDFLib);
      script.onerror = () => reject(new Error("Falha ao carregar pdf-lib"));
      document.head.appendChild(script);
    });
    return _pdfLibPromise;
  }

  const INDICATOR_ORDER = [
    { label: "Indicadores Auxiliares SISGPI", isGroup: true,  format: "currency" },
    { label: "Investimento",                  isGroup: false, format: "currency" },
    { label: "Ebitda",                        isGroup: false, format: "currency" },
    { label: "TIR",                           isGroup: false, format: "percent"  },
    { label: "VPL",                           isGroup: false, format: "currency" },
    { label: "Valor Capex Ajuste",            isGroup: false, format: "currency" },
    { label: "Valor Capex Financeiro Pleito", isGroup: false, format: "currency" },
    { label: "Valor Capex Economico Pleito",  isGroup: false, format: "currency" },
    { label: "Valor Capex Economico Realizado", isGroup: false, format: "currency" },
    { label: "Score",                         isGroup: true,  format: "percent"  },
    { label: "Score Dir. Estratégico",        isGroup: false, format: "percent"  },
    { label: "Score Reputação",               isGroup: false, format: "percent"  },
    { label: "Score Risco Contratual",        isGroup: false, format: "percent"  },
    { label: "Score Risco Operacional",       isGroup: false, format: "percent"  }
  ];

  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display: block; padding: 12px; font-family: "72", "Segoe UI", Arial, sans-serif; font-size: 13px; color: #32363a; }
      .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      button { padding: 8px 14px; border: 1px solid #0a6ed1; background: #0a6ed1; color: #fff; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 13px; }
      button:hover:not(:disabled) { background: #085caf; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      button.secondary { background: #fff; color: #0a6ed1; }
      button.secondary:hover:not(:disabled) { background: #f0f7fc; }
      .progress-bar { margin-top: 8px; height: 6px; background: #eaecee; border-radius: 3px; overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, #0a6ed1, #0596fa); transition: width 0.15s ease; width: 0; }
      .status { margin-top: 10px; font-size: 11px; font-family: Consolas, Monaco, monospace; color: #444; line-height: 1.4; white-space: pre-wrap; max-height: 280px; overflow: auto; padding: 8px; background: #f8f9fa; border: 1px solid #eaecee; border-radius: 4px; }
    </style>
    <div class="controls">
      <button id="btnInspect" class="secondary">Inspecionar Data Binding</button>
      <button id="btnGenerate">Gerar Book PDF</button>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
    <div class="status" id="status">Aguardando Data Binding...</div>
  `;

  class SISGPIBookBuilder extends HTMLElement {
    constructor() {
      super();
      this._shadowRoot = this.attachShadow({ mode: "open" });
      this._shadowRoot.appendChild(template.content.cloneNode(true));

      this._dataBinding = null;
      this._props = {
        headerTitle: "Card SISGPI - Portfólio de Projetos",
        subtitleTemplate: "{count} projetos analisados",
        projectFilterPrefix: "AMZ.",
        userEmail: ""
      };

      this._btnInspect = this._shadowRoot.getElementById("btnInspect");
      this._btnGenerate = this._shadowRoot.getElementById("btnGenerate");
      this._status = this._shadowRoot.getElementById("status");
      this._progress = this._shadowRoot.getElementById("progress");

      this._btnInspect.addEventListener("click", () => this.inspectDataBinding());
      this._btnGenerate.addEventListener("click", () => this.generateBook(""));
    }

    onCustomWidgetBeforeUpdate(_changed) { /* no-op */ }

    onCustomWidgetAfterUpdate(changedProperties) {
      if (changedProperties.headerTitle !== undefined) this._props.headerTitle = changedProperties.headerTitle;
      if (changedProperties.subtitleTemplate !== undefined) this._props.subtitleTemplate = changedProperties.subtitleTemplate;
      if (changedProperties.projectFilterPrefix !== undefined) this._props.projectFilterPrefix = changedProperties.projectFilterPrefix;
      if (changedProperties.userEmail !== undefined) this._props.userEmail = changedProperties.userEmail;

      // PADRÃO CANÔNICO: captura a binding via changedProperties
      if ("myDataBinding" in changedProperties) {
        const db = changedProperties.myDataBinding;
        this._dataBinding = db;
        const state = db && db.state ? db.state : "(?)";
        const len = db && db.data && Array.isArray(db.data) ? db.data.length : "?";
        this._log("[SDK] DataBinding state=" + state + ", data.length=" + len);
      }
    }

    onCustomWidgetResize(_w, _h) { /* no-op */ }

    // =======================================================================
    // PUBLIC METHODS
    // =======================================================================

    inspectDataBinding() {
      this._clearLog();
      this._log("=== INSPEÇÃO v2.2.0 ===");
      this._log("");

      const db = this._dataBinding;
      if (!db) {
        this._log("ERRO: Data binding ainda não chegou.");
        return;
      }

      this._log("[1] Estado:");
      this._log("  state: " + (db.state !== undefined ? String(db.state) : "(não definido)"));
      const data = (db.data && Array.isArray(db.data)) ? db.data : null;
      this._log("  data.length: " + (data ? String(data.length) : "(sem data)"));
      this._log("");

      // Dump COMPLETO do metadata como JSON
      this._log("[2] Metadata (JSON completo):");
      try {
        const json = JSON.stringify(db.metadata, this._safeReplacer(), 2);
        this._log(json || "(metadata é null/undefined)");
      } catch (e) {
        this._log("(erro ao serializar metadata: " + e.message + ")");
        try {
          this._log("Object.keys(metadata): " + Object.keys(db.metadata || {}).join(", "));
        } catch (e2) {}
      }
      this._log("");

      // Dump COMPLETO de data[0] como JSON
      if (data && data.length > 0) {
        this._log("[3] data[0] (JSON completo):");
        try {
          const json = JSON.stringify(data[0], this._safeReplacer(), 2);
          this._log(json || "(data[0] é null/undefined)");
        } catch (e) {
          this._log("(erro ao serializar data[0]: " + e.message + ")");
        }
        this._log("");

        // Lista de chaves measures_N encontradas
        try {
          const keys = Object.keys(data[0]);
          const measureKeys = keys.filter(k => k.indexOf("measures_") === 0);
          const dimKeys = keys.filter(k => k.indexOf("dimensions_") === 0);
          this._log("[4] Resumo da estrutura:");
          this._log("  Chaves dimensões: " + dimKeys.join(", "));
          this._log("  Chaves medidas:   " + measureKeys.join(", "));
        } catch (e) {}
      }
    }

    _safeReplacer() {
      const seen = new WeakSet();
      return function (key, value) {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        if (typeof value === "function") return "[Function]";
        if (typeof value === "number" && isNaN(value)) return "NaN";
        return value;
      };
    }

    _inspectDataBindingOld() {
      // (mantido como referência, não usado)
      this._clearLog();

      const db = this._dataBinding;
      if (!db) {
        this._log("ERRO: Data binding ainda não chegou.");
        this._log("Possíveis causas:");
        this._log("  1. Data Binding não configurado no painel Builder");
        this._log("  2. Story em modo Edit (a binding às vezes só popula em modo View)");
        this._log("  3. Modelo sem dados pra essa combinação de filtros");
        return;
      }

      this._log("[1] Estado:");
      this._log("  state: " + (db.state !== undefined ? String(db.state) : "(não definido)"));
      const data = (db.data && Array.isArray(db.data)) ? db.data : null;
      this._log("  data.length: " + (data ? String(data.length) : "(sem data)"));

      this._log("");
      this._log("[2] Metadata:");
      const md = db.metadata;
      if (!md) {
        this._log("  (sem metadata)");
      } else {
        try {
          const mdKeys = Object.keys(md);
          this._log("  keys: " + mdKeys.join(", "));
          if (md.feeds) {
            this._log("  feeds:");
            for (let i = 0; i < md.feeds.length; i++) {
              const f = md.feeds[i];
              this._log("    [" + i + "] id='" + f.id + "' values=" + (f.values ? f.values.length : "?"));
              if (f.values) {
                for (let j = 0; j < f.values.length; j++) {
                  const v = f.values[j];
                  this._log("      - " + (v.id || "?") + " | " + (v.description || v.label || "?"));
                }
              }
            }
          }
          if (md.dimensions) {
            this._log("  metadata.dimensions: " + md.dimensions.length + " items");
            for (let i = 0; i < md.dimensions.length; i++) {
              this._log("    [" + i + "] " + (md.dimensions[i].id || "?"));
            }
          }
          if (md.mainStructureMembers) {
            this._log("  metadata.mainStructureMembers: " + md.mainStructureMembers.length + " items");
            for (let i = 0; i < md.mainStructureMembers.length; i++) {
              this._log("    [" + i + "] " + (md.mainStructureMembers[i].id || "?"));
            }
          }
        } catch (e) {
          this._log("  (erro ao introspectar metadata: " + e.message + ")");
        }
      }

      if (data && data.length > 0) {
        this._log("");
        this._log("[3] Primeira row (data[0]):");
        const row = data[0];
        try {
          const rowKeys = Object.keys(row);
          this._log("  keys: " + rowKeys.join(", "));
          for (let i = 0; i < rowKeys.length; i++) {
            const k = rowKeys[i];
            const v = row[k];
            if (v === null || v === undefined) {
              this._log("  " + k + ": null/undefined");
            } else if (typeof v !== "object") {
              this._log("  " + k + ": " + String(v));
            } else {
              const id = v.id !== undefined ? String(v.id) : "?";
              const lbl = v.label !== undefined ? String(v.label) : (v.description !== undefined ? String(v.description) : "?");
              const raw = v.raw !== undefined ? String(v.raw) : (v.rawValue !== undefined ? String(v.rawValue) : "-");
              const fmt = v.formatted !== undefined ? String(v.formatted) : (v.formattedValue !== undefined ? String(v.formattedValue) : "");
              this._log("  " + k + ": id='" + id + "' label='" + lbl + "' raw=" + raw + " fmt='" + fmt + "'");
            }
          }
        } catch (e) {
          this._log("  (erro: " + e.message + ")");
        }

        if (data.length > 1) {
          this._log("");
          this._log("[4] Amostra de IDs em data[0..2]:");
          for (let i = 0; i < data.length && i < 3; i++) {
            const r = data[i];
            const parts = [];
            try {
              const ks = Object.keys(r);
              for (let j = 0; j < ks.length; j++) {
                const k = ks[j];
                const v = r[k];
                if (v && typeof v === "object" && (v.id !== undefined || v.label !== undefined)) {
                  parts.push(k + "=" + (v.id || v.label));
                } else if (v && typeof v === "object" && (v.raw !== undefined || v.rawValue !== undefined)) {
                  parts.push(k + "=" + (v.raw !== undefined ? v.raw : v.rawValue));
                }
              }
            } catch (e) {}
            this._log("  [" + i + "] " + parts.join(", "));
          }
        }
      }
    }

    async generateBook(versionLabel) {
      this._clearLog();
      const db = this._dataBinding;
      if (!db) {
        this._log("ERRO: Data Binding ainda não chegou. Configure no Builder.");
        return;
      }
      if (db.state && db.state !== "success") {
        this._log("ERRO: state='" + db.state + "' (esperado 'success')");
        return;
      }
      const data = db.data;
      if (!data || !Array.isArray(data) || data.length === 0) {
        this._log("ERRO: Sem dados (data vazio ou ausente)");
        return;
      }

      this._btnGenerate.disabled = true;
      this._btnInspect.disabled = true;

      try {
        this._log("Recebidos " + data.length + " linhas.");

        const projDimIdx = this._findProjectDimIndex(db);
        if (projDimIdx < 0) {
          this._log("ERRO: Não foi possível identificar a dimensão Projeto.");
          return;
        }
        this._log("Dimensão Projeto = dimensions_" + projDimIdx);

        // Mapa de measures_N -> { id, label } via metadata.mainStructureMembers
        const memberMap = this._buildMemberMap(db.metadata);
        const memberKeys = Object.keys(memberMap);
        this._log("Indicadores configurados (" + memberKeys.length + "):");
        for (let i = 0; i < memberKeys.length; i++) {
          const k = memberKeys[i];
          this._log("  " + k + " -> " + memberMap[k].label);
        }
        if (memberKeys.length === 0) {
          this._log("ERRO: Nenhum indicador encontrado em metadata.mainStructureMembers.");
          this._log("Verifica se as Contas estão configuradas no Builder Panel.");
          return;
        }

        const projects = this._groupByProject(data, projDimIdx, memberMap);
        this._log("Projetos únicos: " + projects.length);

        const prefix = this._props.projectFilterPrefix;
        const amz = projects.filter(p => p.id && p.id.indexOf(prefix) === 0);
        this._log("Projetos com prefixo '" + prefix + "': " + amz.length);

        if (amz.length === 0) {
          this._log("ERRO: Nenhum projeto bate com '" + prefix + "'.");
          for (let i = 0; i < projects.length && i < 5; i++) {
            this._log("  - '" + projects[i].id + "'");
          }
          return;
        }

        amz.sort((a, b) => a.id.localeCompare(b.id));

        this._log("Carregando pdf-lib...");
        const PDFLib = await loadPdfLib();
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        const fontReg = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        this._drawCoverPage(doc, fontReg, fontBold, rgb, amz, versionLabel);
        for (let i = 0; i < amz.length; i++) {
          this._drawProjectPage(doc, fontReg, fontBold, rgb, amz[i], i + 1, amz.length, versionLabel);
          this._setProgress(((i + 1) / amz.length) * 100);
          if (i % 20 === 0) {
            this._log("Renderizando " + (i + 1) + "/" + amz.length + ": " + amz[i].id);
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const bytes = await doc.save();
        const filename = "SISGPI_Book_" + this._timestamp() + ".pdf";
        this._downloadBlob(bytes, filename);
        this._log("PRONTO! " + amz.length + " páginas em " + filename);
        this.dispatchEvent(new Event("onBookGenerated"));
      } catch (e) {
        this._log("ERRO: " + e.message);
        this.dispatchEvent(new Event("onError"));
      } finally {
        this._btnGenerate.disabled = false;
        this._btnInspect.disabled = false;
      }
    }

    // =======================================================================
    // METADATA HELPERS
    // =======================================================================

    _buildMemberMap(metadata) {
      // metadata.mainStructureMembers é um objeto: { measures_0: { id, label }, ... }
      const map = {};
      if (!metadata) return map;
      const msm = metadata.mainStructureMembers;
      if (!msm) return map;
      try {
        if (Array.isArray(msm)) {
          for (let i = 0; i < msm.length; i++) {
            const m = msm[i];
            const key = "measures_" + i;
            map[key] = {
              id: (m && m.id) || "",
              label: (m && (m.label || m.description)) || key
            };
          }
        } else if (typeof msm === "object") {
          const keys = Object.keys(msm);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const m = msm[k];
            map[k] = {
              id: (m && m.id) || "",
              label: (m && (m.label || m.description)) || k
            };
          }
        }
      } catch (e) {}
      return map;
    }

    _findProjectDimIndex(db) {
      try {
        const md = db.metadata;
        // metadata.dimensions pode ser objeto (keyed por dimensions_N) ou array
        if (md && md.dimensions) {
          const dims = md.dimensions;
          if (Array.isArray(dims)) {
            for (let i = 0; i < dims.length; i++) {
              if (dims[i] && dims[i].id === "S00_PROJECT") return i;
            }
          } else if (typeof dims === "object") {
            const keys = Object.keys(dims);
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i]; // ex: "dimensions_0"
              const d = dims[k];
              if (d && d.id === "S00_PROJECT") {
                const idx = parseInt(k.substring("dimensions_".length), 10);
                if (!isNaN(idx)) return idx;
              }
            }
          }
        }
        if (md && md.feeds) {
          for (let i = 0; i < md.feeds.length; i++) {
            const f = md.feeds[i];
            if (f.id === "dimensions" && f.values) {
              for (let j = 0; j < f.values.length; j++) {
                if (f.values[j].id === "S00_PROJECT") return j;
              }
            }
          }
        }
      } catch (e) {}
      return this._inferProjectDimIndex(db.data);
    }

    _inferProjectDimIndex(data) {
      if (!data || data.length === 0) return -1;
      try {
        const row = data[0];
        const keys = Object.keys(row);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (k.indexOf("dimensions_") !== 0) continue;
          const v = row[k];
          if (v && typeof v === "object") {
            const id = v.id || v.label || "";
            if (typeof id === "string" && id.indexOf("AMZ") === 0) {
              const idx = parseInt(k.substring("dimensions_".length), 10);
              if (!isNaN(idx)) return idx;
            }
          }
        }
      } catch (e) {}
      return -1;
    }

    // Cada linha = 1 projeto. Cada measures_N = 1 indicador (mapeado via memberMap).
    _groupByProject(data, projDimIdx, memberMap) {
      const map = new Map();
      const projKey = "dimensions_" + projDimIdx;

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const projMember = row[projKey];
        if (!projMember) continue;
        const projId = projMember.id || projMember.label || "";
        const projDesc = projMember.label || projMember.description || projId;

        if (!map.has(projId)) {
          map.set(projId, { id: projId, description: projDesc, indicators: [] });
        }

        const project = map.get(projId);
        const rowKeys = Object.keys(row);
        for (let j = 0; j < rowKeys.length; j++) {
          const k = rowKeys[j];
          if (k.indexOf("measures_") !== 0) continue;
          const measure = row[k];
          if (!measure) continue;
          const member = memberMap[k] || { id: "", label: k };
          const rawValue = measure.raw !== undefined
            ? measure.raw
            : (measure.rawValue !== undefined ? measure.rawValue : null);
          const formattedValue = measure.formatted !== undefined
            ? measure.formatted
            : (measure.formattedValue !== undefined ? measure.formattedValue : "");
          project.indicators.push({
            accountId: member.id,
            accountDesc: member.label,
            rawValue: rawValue,
            formattedValue: formattedValue
          });
        }
      }

      return Array.from(map.values());
    }

    // =======================================================================
    // PDF RENDERING
    // =======================================================================

    _drawCoverPage(doc, fontReg, fontBold, rgb, projects, versionLabel) {
      const page = doc.addPage([842, 595]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width: 8, height: height, color: rgb(0.04, 0.43, 0.82) });
      page.drawText(this._props.headerTitle, { x: 60, y: height - 140, size: 28, font: fontBold, color: rgb(0.04, 0.43, 0.82) });
      const subtitle = String(this._props.subtitleTemplate || "").replace("{count}", String(projects.length));
      page.drawText(subtitle, { x: 60, y: height - 180, size: 16, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
      if (versionLabel) {
        page.drawText("Versão: " + versionLabel, { x: 60, y: height - 210, size: 12, font: fontReg, color: rgb(0.4, 0.4, 0.4) });
      }
      let sumY = height - 270;
      page.drawText("Projetos incluídos:", { x: 60, y: sumY, size: 12, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      sumY -= 22;
      const maxItemsCol = 18;
      const colWidth = 240;
      const sliced = projects.slice(0, maxItemsCol * 3);
      for (let i = 0; i < sliced.length; i++) {
        const p = sliced[i];
        const col = Math.floor(i / maxItemsCol);
        const row = i % maxItemsCol;
        const x = 60 + col * colWidth;
        const y = sumY - row * 14;
        page.drawText((p.id + " " + p.description).substring(0, 32), { x: x, y: y, size: 9, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
      }
      if (projects.length > sliced.length) {
        page.drawText("... e mais " + (projects.length - sliced.length) + " projetos", { x: 60, y: sumY - maxItemsCol * 14 - 10, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5) });
      }
      page.drawText("Gerado em " + new Date().toLocaleString("pt-BR"), { x: 60, y: 30, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5) });
      if (this._props.userEmail) {
        page.drawText("Por: " + this._props.userEmail, { x: width - 200, y: 30, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5) });
      }
    }

    _drawProjectPage(doc, fontReg, fontBold, rgb, project, pageNum, totalPages, versionLabel) {
      const page = doc.addPage([842, 595]);
      const { width, height } = page.getSize();

      page.drawText("Card SISGPI", { x: 40, y: height - 50, size: 18, font: fontBold, color: rgb(0.04, 0.43, 0.82) });
      const projectLine = project.id + (project.description && project.description !== project.id ? " - " + project.description : "");
      page.drawText(projectLine, { x: 40, y: height - 75, size: 14, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      if (versionLabel) {
        page.drawText("Versão: " + versionLabel, { x: width - 240, y: height - 50, size: 10, font: fontReg, color: rgb(0.4, 0.4, 0.4) });
      }
      page.drawText("Atualizado em " + new Date().toLocaleString("pt-BR"), { x: width - 240, y: height - 65, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5) });
      page.drawLine({ start: { x: 40, y: height - 92 }, end: { x: width - 40, y: height - 92 }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });

      const kpis = this._extractKpis(project.indicators);
      const kpiList = [
        { label: "Score", sub: "em %", value: kpis.score, format: "percent" },
        { label: "Investimento", sub: "", value: kpis.investimento, format: "currency" },
        { label: "Valor Capex Econômico Pleito", sub: "", value: kpis.capexEcoPleito, format: "currency" },
        { label: "Valor Capex Ajuste", sub: "", value: kpis.capexAjuste, format: "currency" }
      ];
      const kpiTopY = height - 110;
      const kpiHeight = 90;
      const kpiAreaWidth = width - 80;
      const tileWidth = (kpiAreaWidth - 30) / 4;
      for (let i = 0; i < kpiList.length; i++) {
        const kpi = kpiList[i];
        const x = 40 + i * (tileWidth + 10);
        page.drawText(kpi.label, { x: x + 10, y: kpiTopY - 18, size: 11, font: fontReg, color: rgb(0.3, 0.3, 0.3), maxWidth: tileWidth - 20 });
        if (kpi.sub) {
          page.drawText(kpi.sub, { x: x + 10, y: kpiTopY - 34, size: 9, font: fontReg, color: rgb(0.55, 0.55, 0.55) });
        }
        page.drawText(this._formatValue(kpi.value, kpi.format), { x: x + 10, y: kpiTopY - 65, size: 22, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
      }

      let tableY = kpiTopY - kpiHeight - 30;
      page.drawText("S00_CAPEX", { x: 40, y: tableY, size: 11, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      tableY -= 22;
      page.drawRectangle({ x: 40, y: tableY - 18, width: width - 80, height: 22, color: rgb(0.95, 0.95, 0.95) });
      page.drawText("Indicador", { x: 50, y: tableY - 12, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText("Valor", { x: width - 200, y: tableY - 12, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      tableY -= 26;

      for (let i = 0; i < INDICATOR_ORDER.length; i++) {
        if (tableY < 50) break;
        const spec = INDICATOR_ORDER[i];
        const indent = spec.isGroup ? 0 : 18;
        const found = this._findIndicator(project.indicators, spec.label);
        if (i % 2 === 1 && !spec.isGroup) {
          page.drawRectangle({ x: 40, y: tableY - 13, width: width - 80, height: 16, color: rgb(0.985, 0.985, 0.985) });
        }
        page.drawText(spec.label, { x: 50 + indent, y: tableY - 9, size: 9.5, font: spec.isGroup ? fontBold : fontReg, color: spec.isGroup ? rgb(0.15, 0.15, 0.15) : rgb(0.25, 0.25, 0.25) });
        const fmtVal = spec.isGroup ? "" : this._formatValue(found ? found.rawValue : null, spec.format);
        const valWidth = fontReg.widthOfTextAtSize(fmtVal, 9.5);
        page.drawText(fmtVal, { x: width - 50 - valWidth, y: tableY - 9, size: 9.5, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
        tableY -= 17;
      }

      page.drawText("Página " + pageNum + " de " + totalPages, { x: width / 2 - 40, y: 25, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5) });
      if (this._props.userEmail) {
        page.drawText(this._props.userEmail, { x: 40, y: 25, size: 8, font: fontReg, color: rgb(0.55, 0.55, 0.55) });
      }
    }

    _findIndicator(indicators, label) {
      for (let i = 0; i < indicators.length; i++) {
        const ind = indicators[i];
        if ((ind.accountDesc && ind.accountDesc === label) || (ind.accountId && ind.accountId === label)) {
          return ind;
        }
      }
      return null;
    }

    _extractKpis(indicators) {
      const find = (label) => {
        const ind = this._findIndicator(indicators, label);
        return ind ? ind.rawValue : null;
      };
      return {
        score: find("Score"),
        investimento: find("Investimento"),
        capexEcoPleito: find("Valor Capex Economico Pleito"),
        capexAjuste: find("Valor Capex Ajuste")
      };
    }

    _formatValue(value, format) {
      if (value === null || value === undefined || value === "") return "-";
      const num = typeof value === "number" ? value : parseFloat(value);
      if (isNaN(num)) return String(value);
      const formatted = num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (format === "percent") return formatted + "%";
      return formatted;
    }

    _setProgress(pct) { this._progress.style.width = pct + "%"; }
    _clearLog() { this._status.textContent = ""; this._setProgress(0); }
    _log(text) {
      const now = new Date().toLocaleTimeString("pt-BR");
      const line = "[" + now + "] " + text + "\n";
      this._status.textContent = (this._status.textContent + line).slice(-3000);
      this._status.scrollTop = this._status.scrollHeight;
    }
    _downloadBlob(bytes, filename) {
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    _timestamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
    }
  }

  customElements.define("com-solveplan-sisgpi-bookbuilder", SISGPIBookBuilder);
})();

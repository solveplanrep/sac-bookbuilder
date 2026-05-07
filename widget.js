(function () {
  "use strict";

  // ===========================================================================
  // SISGPI Book Builder v2.0 - SAC Custom Widget com Data Binding nativa
  // ===========================================================================
  // Recebe dados do modelo S00_CAPEX via Data Binding configurada no Builder
  // do SAC. Agrupa por projeto, filtra os AMZ.xxx e gera PDF multi-página.
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

  // ---- Ordem canônica dos indicadores na tabela (de cima pra baixo) -------
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
      :host {
        display: block;
        padding: 12px;
        font-family: "72", "Segoe UI", Arial, sans-serif;
        font-size: 13px;
        color: #32363a;
      }
      .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      button {
        padding: 8px 14px;
        border: 1px solid #0a6ed1;
        background: #0a6ed1;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
      }
      button:hover:not(:disabled) { background: #085caf; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      button.secondary { background: #fff; color: #0a6ed1; }
      button.secondary:hover:not(:disabled) { background: #f0f7fc; }
      .progress-bar { margin-top: 8px; height: 6px; background: #eaecee; border-radius: 3px; overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, #0a6ed1, #0596fa); transition: width 0.15s ease; width: 0; }
      .status {
        margin-top: 10px;
        font-size: 11px;
        font-family: Consolas, Monaco, monospace;
        color: #444;
        line-height: 1.4;
        white-space: pre-wrap;
        max-height: 240px;
        overflow: auto;
        padding: 8px;
        background: #f8f9fa;
        border: 1px solid #eaecee;
        border-radius: 4px;
      }
    </style>
    <div class="controls">
      <button id="btnInspect" class="secondary">Inspecionar Data Binding</button>
      <button id="btnGenerate">Gerar Book PDF</button>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
    <div class="status" id="status">Aguardando configuração de Data Binding no painel Builder...</div>
  `;

  class SISGPIBookBuilder extends HTMLElement {
    constructor() {
      super();
      this._shadowRoot = this.attachShadow({ mode: "open" });
      this._shadowRoot.appendChild(template.content.cloneNode(true));

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

    // ---- SDK lifecycle ----
    onCustomWidgetBeforeUpdate(_changed) { /* no-op */ }

    onCustomWidgetAfterUpdate(changed) {
      if (changed.headerTitle !== undefined) this._props.headerTitle = changed.headerTitle;
      if (changed.subtitleTemplate !== undefined) this._props.subtitleTemplate = changed.subtitleTemplate;
      if (changed.projectFilterPrefix !== undefined) this._props.projectFilterPrefix = changed.projectFilterPrefix;
      if (changed.userEmail !== undefined) this._props.userEmail = changed.userEmail;
      if ("myDataBinding" in changed) {
        this._log("[SDK] Data binding atualizado (state pode ter mudado).");
      }
    }

    onCustomWidgetResize(_w, _h) { /* no-op */ }

    // =======================================================================
    // PUBLIC METHODS
    // =======================================================================

    inspectDataBinding() {
      this._clearLog();
      this._log("=== INSPEÇÃO DO DATA BINDING ===");

      const binding = this._getBinding();
      if (!binding) {
        this._log("ERRO: Data Binding 'myDataBinding' não está disponível.");
        this._log("Configure no painel Builder do widget:");
        this._log("  - Dimensões: arraste S00_PROJECT e S00_ACCOUNT");
        this._log("  - Medidas: arraste Montante");
        this._log("  - Filtros: VERSION = RF3T25_Oficial");
        this._listAvailableProperties();
        return;
      }

      this._log("Binding encontrado.");
      const state = binding.state || binding.metadata && binding.metadata.state;
      this._log("State: " + (state !== undefined ? String(state) : "(não detectado)"));

      const data = this._extractData(binding);
      if (!data) {
        this._log("data: não encontrado em nenhum dos caminhos conhecidos.");
        this._log("Keys disponíveis no binding:");
        try {
          const keys = Object.keys(binding);
          for (let i = 0; i < keys.length; i++) {
            this._log("  - " + keys[i]);
          }
        } catch (e) {
          this._log("(impossível listar keys: " + e.message + ")");
        }
        return;
      }

      this._log("Total de cells: " + data.length);
      if (data.length === 0) return;

      this._log("");
      this._log("Estrutura do primeiro cell:");
      const first = data[0];
      try {
        const keys = Object.keys(first);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const v = first[k];
          if (v && typeof v === "object") {
            const id = v.id !== undefined ? v.id : "?";
            const desc = v.description !== undefined ? v.description : (v.label !== undefined ? v.label : "?");
            const raw = v.rawValue !== undefined ? v.rawValue : "";
            const fmt = v.formattedValue !== undefined ? v.formattedValue : "";
            this._log("  " + k + ": id='" + id + "' desc='" + desc + "' raw=" + raw + " fmt='" + fmt + "'");
          } else {
            this._log("  " + k + ": " + String(v));
          }
        }
      } catch (e) {
        this._log("(erro ao iterar keys: " + e.message + ")");
      }
    }

    async generateBook(versionLabel) {
      this._clearLog();
      const binding = this._getBinding();
      if (!binding) {
        this._log("ERRO: Configure o Data Binding no painel Builder primeiro.");
        return;
      }

      const data = this._extractData(binding);
      if (!data || data.length === 0) {
        this._log("ERRO: Sem dados disponíveis no binding.");
        return;
      }

      this._btnGenerate.disabled = true;
      this._btnInspect.disabled = true;

      try {
        this._log("Recebidas " + data.length + " cells do data binding.");
        const projects = this._groupByProject(data);
        this._log("Projetos únicos: " + projects.length);

        const prefix = this._props.projectFilterPrefix;
        const amz = projects.filter((p) => p.id && p.id.indexOf(prefix) === 0);
        this._log("Projetos com prefixo '" + prefix + "': " + amz.length);

        if (amz.length === 0) {
          this._log("ERRO: Nenhum projeto bate com '" + prefix + "'.");
          this._log("Primeiros 5 IDs encontrados (pra debug):");
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

        this._log("Renderizando capa...");
        this._drawCoverPage(doc, fontReg, fontBold, rgb, amz, versionLabel);

        for (let i = 0; i < amz.length; i++) {
          this._drawProjectPage(doc, fontReg, fontBold, rgb, amz[i], i + 1, amz.length, versionLabel);
          this._setProgress(((i + 1) / amz.length) * 100);
          if (i % 20 === 0) {
            this._log("Renderizando " + (i + 1) + "/" + amz.length + ": " + amz[i].id);
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        const bytes = await doc.save();
        const filename = "SISGPI_Book_" + this._timestamp() + ".pdf";
        this._downloadBlob(bytes, filename);
        this._log("PRONTO! " + amz.length + " páginas geradas.");
        this._log("Download: " + filename);
        this.dispatchEvent(new Event("onBookGenerated"));
      } catch (e) {
        this._log("ERRO durante geração: " + e.message);
        this.dispatchEvent(new Event("onError"));
      } finally {
        this._btnGenerate.disabled = false;
        this._btnInspect.disabled = false;
      }
    }

    // =======================================================================
    // DATA BINDING ACCESS - tenta múltiplos caminhos pra robustez
    // =======================================================================

    _getBinding() {
      try {
        if (this.dataBindings && typeof this.dataBindings.getDataBinding === "function") {
          return this.dataBindings.getDataBinding("myDataBinding");
        }
        if (this.dataBindings && this.dataBindings.myDataBinding) {
          return this.dataBindings.myDataBinding;
        }
        if (this.myDataBinding) {
          return this.myDataBinding;
        }
      } catch (e) {
        this._log("(erro ao acessar binding: " + e.message + ")");
      }
      return null;
    }

    _extractData(binding) {
      if (Array.isArray(binding)) return binding;
      if (binding.data && Array.isArray(binding.data)) return binding.data;
      if (binding.dataBindings && binding.dataBindings.data) return binding.dataBindings.data;
      return null;
    }

    _listAvailableProperties() {
      this._log("");
      this._log("Propriedades disponíveis em this:");
      const candidates = ["dataBindings", "myDataBinding", "dataBinding"];
      for (let i = 0; i < candidates.length; i++) {
        const k = candidates[i];
        if (this[k] !== undefined) {
          this._log("  - this." + k + ": " + (typeof this[k]));
        } else {
          this._log("  - this." + k + ": undefined");
        }
      }
    }

    // =======================================================================
    // GROUPING - tenta vários nomes de chaves possíveis
    // =======================================================================

    _findKey(obj, candidates) {
      for (let i = 0; i < candidates.length; i++) {
        if (obj[candidates[i]] !== undefined) return candidates[i];
      }
      return null;
    }

    _groupByProject(data) {
      const map = new Map();

      for (let i = 0; i < data.length; i++) {
        const cell = data[i];

        const projKey = this._findKey(cell, ["S00_PROJECT", "[S00_PROJECT]", "S00_PROJECT_ID"]);
        if (!projKey) continue;
        const projMember = cell[projKey];
        if (!projMember) continue;

        const projId = (projMember.id !== undefined ? projMember.id : projMember.label) || "";
        const projDesc = projMember.description || projMember.label || projId;

        if (!map.has(projId)) {
          map.set(projId, { id: projId, description: projDesc, indicators: [] });
        }

        // Account
        const accKey = this._findKey(cell, ["S00_ACCOUNT", "[S00_ACCOUNT]"]);
        const accMember = accKey ? cell[accKey] : null;

        // Value: tenta encontrar a primeira propriedade com rawValue ou formattedValue
        let valMember = null;
        try {
          const keys = Object.keys(cell);
          for (let k = 0; k < keys.length; k++) {
            const v = cell[keys[k]];
            if (v && typeof v === "object" && (v.rawValue !== undefined || v.formattedValue !== undefined)) {
              valMember = v;
              break;
            }
          }
        } catch (e) { /* ignore */ }

        map.get(projId).indicators.push({
          accountId: accMember && accMember.id !== undefined ? accMember.id : "",
          accountDesc: accMember && (accMember.description || accMember.label) ? (accMember.description || accMember.label) : "",
          rawValue: valMember && valMember.rawValue !== undefined ? valMember.rawValue : null,
          formattedValue: valMember && valMember.formattedValue ? valMember.formattedValue : ""
        });
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
      page.drawText(this._props.headerTitle, {
        x: 60, y: height - 140, size: 28, font: fontBold, color: rgb(0.04, 0.43, 0.82)
      });

      const subtitle = String(this._props.subtitleTemplate || "").replace("{count}", String(projects.length));
      page.drawText(subtitle, {
        x: 60, y: height - 180, size: 16, font: fontReg, color: rgb(0.3, 0.3, 0.3)
      });

      if (versionLabel) {
        page.drawText("Versão: " + versionLabel, {
          x: 60, y: height - 210, size: 12, font: fontReg, color: rgb(0.4, 0.4, 0.4)
        });
      }

      let sumY = height - 270;
      page.drawText("Projetos incluídos:", {
        x: 60, y: sumY, size: 12, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
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
        const label = (p.id + " " + p.description).substring(0, 32);
        page.drawText(label, { x: x, y: y, size: 9, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
      }
      if (projects.length > sliced.length) {
        page.drawText("... e mais " + (projects.length - sliced.length) + " projetos", {
          x: 60, y: sumY - maxItemsCol * 14 - 10,
          size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
        });
      }

      page.drawText("Gerado em " + new Date().toLocaleString("pt-BR"), {
        x: 60, y: 30, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
      });
      if (this._props.userEmail) {
        page.drawText("Por: " + this._props.userEmail, {
          x: width - 200, y: 30, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
        });
      }
    }

    _drawProjectPage(doc, fontReg, fontBold, rgb, project, pageNum, totalPages, versionLabel) {
      const page = doc.addPage([842, 595]);
      const { width, height } = page.getSize();

      // Header
      page.drawText("Card SISGPI", {
        x: 40, y: height - 50, size: 18, font: fontBold, color: rgb(0.04, 0.43, 0.82)
      });
      const projectLine = project.id + (project.description && project.description !== project.id ? " - " + project.description : "");
      page.drawText(projectLine, {
        x: 40, y: height - 75, size: 14, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      if (versionLabel) {
        page.drawText("Versão: " + versionLabel, {
          x: width - 240, y: height - 50, size: 10, font: fontReg, color: rgb(0.4, 0.4, 0.4)
        });
      }
      page.drawText("Atualizado em " + new Date().toLocaleString("pt-BR"), {
        x: width - 240, y: height - 65, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
      });

      page.drawLine({
        start: { x: 40, y: height - 92 }, end: { x: width - 40, y: height - 92 },
        thickness: 1, color: rgb(0.85, 0.85, 0.85)
      });

      // KPIs
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
        page.drawText(kpi.label, {
          x: x + 10, y: kpiTopY - 18, size: 11, font: fontReg, color: rgb(0.3, 0.3, 0.3),
          maxWidth: tileWidth - 20
        });
        if (kpi.sub) {
          page.drawText(kpi.sub, {
            x: x + 10, y: kpiTopY - 34, size: 9, font: fontReg, color: rgb(0.55, 0.55, 0.55)
          });
        }
        page.drawText(this._formatValue(kpi.value, kpi.format), {
          x: x + 10, y: kpiTopY - 65, size: 22, font: fontBold, color: rgb(0.1, 0.1, 0.1)
        });
      }

      // Tabela de indicadores
      let tableY = kpiTopY - kpiHeight - 30;
      page.drawText("S00_CAPEX", {
        x: 40, y: tableY, size: 11, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      tableY -= 22;

      page.drawRectangle({
        x: 40, y: tableY - 18, width: width - 80, height: 22, color: rgb(0.95, 0.95, 0.95)
      });
      page.drawText("Indicador", {
        x: 50, y: tableY - 12, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      page.drawText("Valor", {
        x: width - 200, y: tableY - 12, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      tableY -= 26;

      for (let i = 0; i < INDICATOR_ORDER.length; i++) {
        if (tableY < 50) break;
        const spec = INDICATOR_ORDER[i];
        const indent = spec.isGroup ? 0 : 18;

        const found = this._findIndicator(project.indicators, spec.label);
        if (i % 2 === 1 && !spec.isGroup) {
          page.drawRectangle({
            x: 40, y: tableY - 13, width: width - 80, height: 16, color: rgb(0.985, 0.985, 0.985)
          });
        }
        page.drawText(spec.label, {
          x: 50 + indent, y: tableY - 9, size: 9.5,
          font: spec.isGroup ? fontBold : fontReg,
          color: spec.isGroup ? rgb(0.15, 0.15, 0.15) : rgb(0.25, 0.25, 0.25)
        });
        const fmtVal = spec.isGroup ? "" : this._formatValue(found ? found.rawValue : null, spec.format);
        const valWidth = fontReg.widthOfTextAtSize(fmtVal, 9.5);
        page.drawText(fmtVal, {
          x: width - 50 - valWidth, y: tableY - 9, size: 9.5,
          font: fontReg, color: rgb(0.2, 0.2, 0.2)
        });
        tableY -= 17;
      }

      // Footer
      page.drawText("Página " + pageNum + " de " + totalPages, {
        x: width / 2 - 40, y: 25, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
      });
      if (this._props.userEmail) {
        page.drawText(this._props.userEmail, {
          x: 40, y: 25, size: 8, font: fontReg, color: rgb(0.55, 0.55, 0.55)
        });
      }
    }

    _findIndicator(indicators, label) {
      for (let i = 0; i < indicators.length; i++) {
        const ind = indicators[i];
        if ((ind.accountDesc && ind.accountDesc === label) ||
            (ind.accountId && ind.accountId === label)) {
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
      const formatted = num.toLocaleString("pt-BR", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
      if (format === "percent") return formatted + "%";
      return formatted;
    }

    _setProgress(pct) {
      this._progress.style.width = pct + "%";
    }

    _clearLog() {
      this._status.textContent = "";
      this._setProgress(0);
    }

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

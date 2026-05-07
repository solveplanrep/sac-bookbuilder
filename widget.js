(function () {
  "use strict";

  // ===========================================================================
  // SISGPI Book Builder - Custom Widget para SAP Analytics Cloud
  // ===========================================================================
  // Recebe dados de projetos via método público addPage(...) e gera um PDF
  // multi-página (uma página por projeto) reproduzindo o layout do Card SISGPI.
  // ===========================================================================

  const PDFLIB_CDN = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";

  // ---------- Carregamento do pdf-lib ----------
  let _pdfLibPromise = null;
  function loadPdfLib() {
    if (_pdfLibPromise) return _pdfLibPromise;
    _pdfLibPromise = new Promise((resolve, reject) => {
      if (window.PDFLib) {
        resolve(window.PDFLib);
        return;
      }
      const script = document.createElement("script");
      script.src = PDFLIB_CDN;
      script.onload = () => resolve(window.PDFLib);
      script.onerror = () => reject(new Error("Falha ao carregar pdf-lib do CDN"));
      document.head.appendChild(script);
    });
    return _pdfLibPromise;
  }

  // ---------- Template do widget ----------
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
        padding: 8px 16px;
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
      .status {
        margin-left: 8px;
        font-size: 12px;
        color: #666;
      }
      .progress-bar {
        margin-top: 10px;
        height: 6px;
        background: #eaecee;
        border-radius: 3px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #0a6ed1, #0596fa);
        transition: width 0.15s ease;
        width: 0;
      }
    </style>
    <div class="controls">
      <button id="btnGenerate">Gerar Book PDF</button>
      <button id="btnReset" class="secondary">Limpar</button>
      <span class="status" id="status">0 páginas no buffer</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
  `;

  class SISGPIBookBuilder extends HTMLElement {
    constructor() {
      super();
      this._shadowRoot = this.attachShadow({ mode: "open" });
      this._shadowRoot.appendChild(template.content.cloneNode(true));

      this._pages = [];
      this._props = {
        headerTitle: "Card SISGPI - Portfólio de Projetos",
        subtitleTemplate: "{count} projetos analisados",
        buttonLabel: "Gerar Book PDF",
        logoUrl: "",
        userEmail: ""
      };

      this._btnGenerate = this._shadowRoot.getElementById("btnGenerate");
      this._btnReset = this._shadowRoot.getElementById("btnReset");
      this._status = this._shadowRoot.getElementById("status");
      this._progress = this._shadowRoot.getElementById("progress");

      this._btnGenerate.addEventListener("click", () => this.generateAndDownload(""));
      this._btnReset.addEventListener("click", () => this.resetBook());
    }

    // ---------- SAC Custom Widget lifecycle ----------
    onCustomWidgetBeforeUpdate(_changed) { /* no-op */ }

    onCustomWidgetAfterUpdate(changed) {
      if (changed.headerTitle !== undefined) this._props.headerTitle = changed.headerTitle;
      if (changed.subtitleTemplate !== undefined) this._props.subtitleTemplate = changed.subtitleTemplate;
      if (changed.buttonLabel !== undefined) {
        this._props.buttonLabel = changed.buttonLabel;
        this._btnGenerate.textContent = changed.buttonLabel;
      }
      if (changed.logoUrl !== undefined) this._props.logoUrl = changed.logoUrl;
      if (changed.userEmail !== undefined) this._props.userEmail = changed.userEmail;
    }

    // ===========================================================================
    // PUBLIC METHODS - chamados pelo Analytic Application script
    // ===========================================================================

    addPage(projectCode, projectName, kpisJson, indicatorsJson) {
      try {
        const kpis = typeof kpisJson === "string" ? JSON.parse(kpisJson) : (kpisJson || {});
        const indicators = typeof indicatorsJson === "string" ? JSON.parse(indicatorsJson) : (indicatorsJson || []);
        this._pages.push({
          projectCode: projectCode || "",
          projectName: projectName || "",
          kpis: kpis,
          indicators: indicators
        });
        this._updateStatus();
        this._dispatch("onPageAdded");
      } catch (e) {
        this._status.textContent = "Erro em addPage: " + e.message;
        this._dispatch("onError");
      }
    }

    resetBook() {
      this._pages = [];
      this._updateStatus();
      this._setProgress(0);
    }

    getPageCount() {
      return this._pages.length;
    }

    async generateAndDownload(versionLabel) {
      if (this._pages.length === 0) {
        this._status.textContent = "Nenhuma página no buffer. Use addPage() antes de gerar.";
        return;
      }
      try {
        this._btnGenerate.disabled = true;
        this._btnReset.disabled = true;
        this._status.textContent = "Carregando biblioteca PDF...";

        const PDFLib = await loadPdfLib();
        const { PDFDocument, StandardFonts, rgb } = PDFLib;

        const doc = await PDFDocument.create();
        const fontReg = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        // Capa
        await this._drawCoverPage(doc, fontReg, fontBold, rgb, versionLabel);

        // Páginas dos projetos
        const total = this._pages.length;
        for (let i = 0; i < total; i++) {
          this._drawProjectPage(doc, fontReg, fontBold, rgb, this._pages[i], i + 1, total, versionLabel);
          this._status.textContent = "Renderizando " + (i + 1) + "/" + total + "...";
          this._setProgress(((i + 1) / total) * 100);
          // Yield ao event loop a cada 10 páginas pra UI não travar
          if (i % 10 === 9) {
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const bytes = await doc.save();
        this._downloadBlob(bytes, "SISGPI_Book_" + this._timestamp() + ".pdf");
        this._status.textContent = "Pronto! " + total + " páginas geradas.";
        this._dispatch("onBookGenerated");
      } catch (e) {
        this._status.textContent = "Erro: " + e.message;
        this._dispatch("onError");
      } finally {
        this._btnGenerate.disabled = false;
        this._btnReset.disabled = false;
      }
    }

    // ===========================================================================
    // PRIVATE - Renderização do PDF
    // ===========================================================================

    _drawCoverPage(doc, fontReg, fontBold, rgb, versionLabel) {
      const page = doc.addPage([842, 595]); // A4 paisagem
      const { width, height } = page.getSize();

      // Faixa azul lateral
      page.drawRectangle({
        x: 0, y: 0, width: 8, height: height,
        color: rgb(0.04, 0.43, 0.82)
      });

      // Título
      page.drawText(this._props.headerTitle, {
        x: 60, y: height - 140,
        size: 28, font: fontBold, color: rgb(0.04, 0.43, 0.82)
      });

      // Subtítulo
      const subtitle = (this._props.subtitleTemplate || "")
        .replace("{count}", String(this._pages.length));
      page.drawText(subtitle, {
        x: 60, y: height - 180,
        size: 16, font: fontReg, color: rgb(0.3, 0.3, 0.3)
      });

      // Versão
      if (versionLabel) {
        page.drawText("Versão: " + versionLabel, {
          x: 60, y: height - 210,
          size: 12, font: fontReg, color: rgb(0.4, 0.4, 0.4)
        });
      }

      // Sumário dos primeiros projetos (até caber)
      let sumY = height - 270;
      page.drawText("Projetos incluídos:", {
        x: 60, y: sumY,
        size: 12, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      sumY -= 22;
      const maxItemsCol = 18;
      const colWidth = 240;
      this._pages.slice(0, maxItemsCol * 3).forEach((p, i) => {
        const col = Math.floor(i / maxItemsCol);
        const row = i % maxItemsCol;
        const x = 60 + col * colWidth;
        const y = sumY - row * 14;
        const label = (p.projectCode + " " + p.projectName).substring(0, 30);
        page.drawText(label, {
          x: x, y: y,
          size: 9, font: fontReg, color: rgb(0.3, 0.3, 0.3)
        });
      });
      if (this._pages.length > maxItemsCol * 3) {
        page.drawText("... e mais " + (this._pages.length - maxItemsCol * 3) + " projetos", {
          x: 60, y: sumY - maxItemsCol * 14 - 10,
          size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
        });
      }

      // Rodapé
      const footerY = 30;
      page.drawText("Gerado em " + new Date().toLocaleString("pt-BR"), {
        x: 60, y: footerY,
        size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
      });
      if (this._props.userEmail) {
        page.drawText("Por: " + this._props.userEmail, {
          x: width - 200, y: footerY,
          size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
        });
      }
    }

    _drawProjectPage(doc, fontReg, fontBold, rgb, pageData, pageNum, totalPages, versionLabel) {
      const page = doc.addPage([842, 595]); // A4 paisagem
      const { width, height } = page.getSize();

      // ---- Header ----
      page.drawText("Card SISGPI", {
        x: 40, y: height - 50,
        size: 18, font: fontBold, color: rgb(0.04, 0.43, 0.82)
      });
      const projectLine = pageData.projectCode + (pageData.projectName ? " - " + pageData.projectName : "");
      page.drawText(projectLine, {
        x: 40, y: height - 75,
        size: 14, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      if (versionLabel) {
        page.drawText("Versão: " + versionLabel, {
          x: width - 240, y: height - 50,
          size: 10, font: fontReg, color: rgb(0.4, 0.4, 0.4)
        });
      }
      page.drawText("Atualizado em " + new Date().toLocaleString("pt-BR"), {
        x: width - 240, y: height - 65,
        size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
      });

      // Linha separadora
      page.drawLine({
        start: { x: 40, y: height - 92 },
        end: { x: width - 40, y: height - 92 },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.85)
      });

      // ---- KPIs (4 tiles) ----
      const kpis = pageData.kpis || {};
      const kpiList = [
        { label: "Score", sub: "em %", value: kpis.score, format: "percent" },
        { label: "Investimento", sub: "", value: kpis.investimento, format: "currency" },
        { label: "Valor Capex Econômico Pleito", sub: "", value: kpis.valorCapexEconomicoPleito, format: "currency" },
        { label: "Valor Capex Ajuste", sub: "", value: kpis.valorCapexAjuste, format: "currency" }
      ];
      const kpiTopY = height - 110;
      const kpiHeight = 90;
      const kpiAreaWidth = width - 80;
      const tileWidth = (kpiAreaWidth - 30) / 4; // 10px gap entre tiles
      kpiList.forEach((kpi, i) => {
        const x = 40 + i * (tileWidth + 10);
        page.drawText(kpi.label, {
          x: x + 10, y: kpiTopY - 18,
          size: 11, font: fontReg, color: rgb(0.3, 0.3, 0.3),
          maxWidth: tileWidth - 20
        });
        if (kpi.sub) {
          page.drawText(kpi.sub, {
            x: x + 10, y: kpiTopY - 34,
            size: 9, font: fontReg, color: rgb(0.55, 0.55, 0.55)
          });
        }
        page.drawText(this._formatValue(kpi.value, kpi.format), {
          x: x + 10, y: kpiTopY - 65,
          size: 22, font: fontBold, color: rgb(0.1, 0.1, 0.1)
        });
        page.drawText(kpi.label, {
          x: x + 10, y: kpiTopY - 84,
          size: 8, font: fontReg, color: rgb(0.55, 0.55, 0.55),
          maxWidth: tileWidth - 20
        });
      });

      // ---- Tabela de indicadores ----
      let tableY = kpiTopY - kpiHeight - 30;
      page.drawText("S00_CAPEX", {
        x: 40, y: tableY,
        size: 11, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      tableY -= 22;

      // Cabeçalho da tabela
      page.drawRectangle({
        x: 40, y: tableY - 18, width: width - 80, height: 22,
        color: rgb(0.95, 0.95, 0.95)
      });
      page.drawText("Indicador", {
        x: 50, y: tableY - 12,
        size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      page.drawText("Valor", {
        x: width - 200, y: tableY - 12,
        size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2)
      });
      tableY -= 26;

      // Linhas
      const indicators = pageData.indicators || [];
      indicators.forEach((ind, i) => {
        if (tableY < 50) return; // overflow guard
        const isGroup = !!ind.isGroup;
        const indent = isGroup ? 0 : 18;
        if (i % 2 === 1 && !isGroup) {
          page.drawRectangle({
            x: 40, y: tableY - 13, width: width - 80, height: 16,
            color: rgb(0.985, 0.985, 0.985)
          });
        }
        page.drawText(String(ind.label || ""), {
          x: 50 + indent, y: tableY - 9,
          size: 9.5,
          font: isGroup ? fontBold : fontReg,
          color: isGroup ? rgb(0.15, 0.15, 0.15) : rgb(0.25, 0.25, 0.25)
        });
        const fmtVal = this._formatValue(ind.value, ind.format || "currency");
        const valWidth = fontReg.widthOfTextAtSize(fmtVal, 9.5);
        page.drawText(fmtVal, {
          x: width - 50 - valWidth, y: tableY - 9, // alinhamento à direita
          size: 9.5, font: fontReg, color: rgb(0.2, 0.2, 0.2)
        });
        tableY -= 17;
      });

      // ---- Footer ----
      page.drawText("Página " + pageNum + " de " + totalPages, {
        x: width / 2 - 40, y: 25,
        size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5)
      });
      if (this._props.userEmail) {
        page.drawText(this._props.userEmail, {
          x: 40, y: 25,
          size: 8, font: fontReg, color: rgb(0.55, 0.55, 0.55)
        });
      }
    }

    // ---------- Helpers ----------
    _formatValue(value, format) {
      if (value === null || value === undefined || value === "") return "-";
      const num = typeof value === "number" ? value : parseFloat(value);
      if (isNaN(num)) return String(value);
      const formatted = num.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      if (format === "percent") return formatted + "%";
      return formatted;
    }

    _updateStatus() {
      const n = this._pages.length;
      this._status.textContent = n + " " + (n === 1 ? "página" : "páginas") + " no buffer";
    }

    _setProgress(pct) {
      this._progress.style.width = pct + "%";
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

    _dispatch(name) {
      this.dispatchEvent(new Event(name));
    }
  }

  customElements.define("com-solveplan-sisgpi-bookbuilder", SISGPIBookBuilder);
})();

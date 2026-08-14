(()=>{
  "use strict";
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const compact=items=>items.filter(value=>value!==undefined&&value!==null&&String(value).trim()!=="");
  const supportLabels={aliases:"別名",lineage:"系譜",aromas:"香り",breeder:"ブリーダー",terpenes:"テルペン",origin:"起源",history:"来歴"};
  const searchText=strain=>compact([strain.id,strain.name,strain.jp,strain.type?.key,strain.type?.label,...(strain.aliases||[]),strain.lineage?.display,...(strain.lineage?.parents||[]),strain.lineage?.note,...(strain.aromas||[]),strain.breeder?.name,strain.breeder?.era,...(strain.terpenes||[]),strain.originHistory,strain.history]).join(" ").toLowerCase();
  const row=(label,value)=>value===undefined||value===null||String(value).trim()===""?"":`<div class="fact-row"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
  const sourceCard=source=>{
    if(!source)return"";
    const supports=(source.supports||[]).map(key=>supportLabels[key]||key);
    return `<article class="source-card"><div class="source-main"><a class="source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)} <span aria-hidden="true">↗</span></a><div class="source-meta">${esc(source.typeLabel||source.type||"SOURCE")}${source.checked?` ・ 確認 ${esc(source.checked)}`:""}</div></div>${supports.length?`<div class="source-supports">${supports.map(label=>`<span>${esc(label)}</span>`).join("")}</div>`:""}</article>`;
  };
  const visualFigure=(visual,primary=false)=>{
    if(!visual)return"";
    const label=visual.label||"VISUAL",ai=visual.aiGenerated===true;
    return `<figure class="${primary?"primary-visual":"visual-figure"}"><div class="visual-frame"><img src="${esc(visual.src)}" alt="${esc(visual.alt||"")}" loading="${primary?"eager":"lazy"}"><div class="visual-badges"><span class="visual-role">${esc(label)}</span>${ai?`<span class="ai-badge">AI GENERATED</span>`:""}</div></div>${primary?"":`<figcaption>${esc(label)}${ai?" ・ AI生成の参考表現":""}</figcaption>`}</figure>`;
  };
  const reviewCard=review=>`<article class="review"><div class="review-head"><div class="review-title">${esc(review.title||"REVIEW")}</div>${review.date?`<time>${esc(review.date)}</time>`:""}</div>${review.product||review.subject?`<div class="review-product">${esc(review.product||review.subject)}</div>`:""}<div class="review-body">${esc(review.body||"")}</div></article>`;
  const renderCard=strain=>{
    const primaryVisual=(strain.visuals||[])[0],extraVisuals=(strain.visuals||[]).slice(1),sources=(strain.sourceIds||[]).map(id=>window.SOURCES?.[id]).filter(Boolean),aliases=(strain.aliases||[]).join(" / "),breeder=compact([strain.breeder?.name,strain.breeder?.era]).join(" / "),terpeneText=(strain.terpenes||[]).join("・"),aromaText=(strain.aromas||[]).join("・"),reviews=strain.reviews||[],aromaData=(strain.aromas||[]).map(value=>String(value).toLowerCase()).join("\u001f");
    return `<details class="card" data-search="${esc(searchText(strain))}" data-type="${esc(strain.type?.key||"")}" data-aromas="${esc(aromaData)}" id="${esc(strain.id)}"><summary><div class="visual">${visualFigure(primaryVisual,true)}</div><div class="body"><h3>${esc(strain.name)}</h3><div class="jp">${esc(strain.jp)}</div><span class="type" data-type="${esc(strain.type?.key||"")}">${esc(strain.type?.label||"")}</span>${row("LINEAGE",strain.lineage?.display)}${row("AROMA",aromaText)}<div class="tap"><span>タップして詳細を見る</span><span class="chev">⌄</span></div></div></summary><div class="details"><div class="scope-note">${esc(strain.identity?.note||"")}</div>${extraVisuals.length?`<section class="details-section"><div class="section-title">VISUALS</div><div class="gallery">${extraVisuals.map(visual=>visualFigure(visual,false)).join("")}</div><p class="visual-policy">掲載画像はAI生成の参考ビジュアルです。特定ロットやフェノタイプの実物標本写真ではありません。</p></section>`:""}<section class="details-section facts-section"><div class="section-title">FACTS</div>${row("ALIAS",aliases)}${row("BREEDER / ERA",breeder)}${row("LINEAGE NOTE",strain.lineage?.note)}${row("ORIGIN / HISTORY",strain.originHistory)}${row("REPORTED TERPENES",terpeneText)}${row("HISTORY / NOTE",strain.history)}${row("CONFIDENCE",compact([strain.confidence?.display,strain.confidence?.note]).join(" — "))}</section>${sources.length?`<section class="details-section sources-section"><div class="section-title">SOURCES</div><div class="sources">${sources.map(sourceCard).join("")}</div></section>`:""}${reviews.length?`<section class="details-section reviews-section"><div class="section-title">REVIEW / EXPERIENCE</div><p class="review-policy">ここから下は品種一般の事実情報ではなく、特定製品・ロットについての個人体験です。</p>${reviews.map(reviewCard).join("")}</section>`:""}</div></details>`;
  };

  const cards=document.getElementById("cards");
  if(!cards||!Array.isArray(window.STRAINS))return;
  cards.innerHTML=window.STRAINS.map(renderCard).join("");

  const count=document.getElementById("count");
  if(count)count.textContent=`${window.STRAINS.length} CULTIVARS`;

  const state={type:"",aroma:""};
  const q=document.getElementById("q");
  const typeFilters=document.getElementById("type-filters");
  const aromaFilters=document.getElementById("aroma-filters");
  const filterState=document.getElementById("filter-state");
  const filterStateText=document.getElementById("filter-state-text");
  const empty=document.getElementById("catalog-empty");

  const uniqueBy=(items,keyFn)=>{
    const seen=new Set();
    return items.filter(item=>{const key=keyFn(item);if(!key||seen.has(key))return false;seen.add(key);return true;});
  };
  const typeOptions=uniqueBy(window.STRAINS.map(strain=>({key:strain.type?.key||"",label:strain.type?.label||""})),item=>item.key);
  const aromaOptions=[];
  const aromaSeen=new Set();
  window.STRAINS.forEach(strain=>(strain.aromas||[]).forEach(aroma=>{const value=String(aroma);if(!aromaSeen.has(value)){aromaSeen.add(value);aromaOptions.push(value);}}));

  const renderFilterOptions=()=>{
    if(typeFilters)typeFilters.innerHTML=typeOptions.map(item=>`<button class="filter-chip" type="button" data-filter-kind="type" data-filter-value="${esc(item.key)}" aria-pressed="false">${esc(item.label)}</button>`).join("");
    if(aromaFilters)aromaFilters.innerHTML=aromaOptions.map(value=>`<button class="filter-chip" type="button" data-filter-kind="aroma" data-filter-value="${esc(value)}" aria-pressed="false">${esc(value)}</button>`).join("");
  };

  const typeLabel=key=>typeOptions.find(item=>item.key===key)?.label||key;
  const updateFilterUi=()=>{
    document.querySelectorAll(".filter-chip").forEach(button=>{
      const kind=button.dataset.filterKind,value=button.dataset.filterValue||"";
      button.setAttribute("aria-pressed",String(state[kind]===value));
    });
    const typeSub=document.querySelector('[data-filter-panel="type"] .discovery-sub');
    const aromaSub=document.querySelector('[data-filter-panel="aroma"] .discovery-sub');
    if(typeSub)typeSub.textContent=state.type?typeLabel(state.type):"系統から探す";
    if(aromaSub)aromaSub.textContent=state.aroma?state.aroma:"香りから探す";
  };

  const applyFilters=()=>{
    const query=(q?.value||"").trim().toLowerCase();
    let visible=0;
    document.querySelectorAll(".card").forEach(card=>{
      const aromas=(card.dataset.aromas||"").split("\u001f").filter(Boolean);
      const matchesQuery=!query||(card.dataset.search||"").includes(query);
      const matchesType=!state.type||card.dataset.type===state.type;
      const matchesAroma=!state.aroma||aromas.includes(state.aroma.toLowerCase());
      const show=matchesQuery&&matchesType&&matchesAroma;
      card.style.display=show?"block":"none";
      if(show)visible+=1;
    });
    const parts=[];
    if(state.type)parts.push(`TYPE / ${typeLabel(state.type)}`);
    if(state.aroma)parts.push(`AROMA / ${state.aroma}`);
    if(query)parts.push(`SEARCH / ${q.value.trim()}`);
    if(filterState&&filterStateText){
      filterState.hidden=parts.length===0;
      filterStateText.innerHTML=parts.length?`${parts.map(esc).join(" ・ ")} <strong>${visible} CULTIVAR${visible===1?"":"S"}</strong>`:"";
    }
    if(empty)empty.classList.toggle("is-visible",visible===0);
  };

  const closeOtherPanels=current=>{
    document.querySelectorAll(".discovery-trigger").forEach(trigger=>{
      if(trigger===current)return;
      trigger.setAttribute("aria-expanded","false");
      const panel=document.getElementById(`${trigger.dataset.filterPanel}-filter-panel`);
      if(panel)panel.hidden=true;
    });
  };

  renderFilterOptions();
  updateFilterUi();
  applyFilters();

  document.querySelectorAll(".discovery-trigger").forEach(trigger=>trigger.addEventListener("click",()=>{
    const panel=document.getElementById(`${trigger.dataset.filterPanel}-filter-panel`);
    if(!panel)return;
    const open=trigger.getAttribute("aria-expanded")==="true";
    closeOtherPanels(trigger);
    trigger.setAttribute("aria-expanded",String(!open));
    panel.hidden=open;
  }));

  document.querySelector(".discovery")?.addEventListener("click",event=>{
    const chip=event.target.closest(".filter-chip");
    if(chip){
      const kind=chip.dataset.filterKind,value=chip.dataset.filterValue||"";
      state[kind]=state[kind]===value?"":value;
      updateFilterUi();
      applyFilters();
      return;
    }
    if(event.target.closest("#filter-clear")){
      state.type="";state.aroma="";
      if(q)q.value="";
      updateFilterUi();
      applyFilters();
    }
  });

  document.querySelectorAll(".card").forEach(card=>card.addEventListener("toggle",()=>{if(card.open)document.querySelectorAll(".card[open]").forEach(other=>{if(other!==card)other.open=false;});}));
  q?.addEventListener("input",applyFilters);
  q?.addEventListener("keydown",event=>{if(event.key==="Enter")applyFilters();});
  document.getElementById("search-btn")?.addEventListener("click",applyFilters);
})();
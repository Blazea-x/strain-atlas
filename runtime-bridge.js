(()=>{
  "use strict";

  const TYPE_LABELS={
    "sativa-dominant-hybrid":"サティバ優勢",
    "sativa-dominant":"サティバ優勢",
    "indica-dominant-hybrid":"インディカ優勢",
    "indica-dominant":"インディカ優勢",
    "hybrid":"ハイブリッド",
    "unknown":"未分類"
  };

  const SOURCE_TYPE_LABELS={
    breederOfficial:"BREEDER OFFICIAL",
    specialistDatabase:"SPECIALIST DATABASE",
    historicalSource:"HISTORICAL SOURCE"
  };

  const unique=items=>[...new Set(items.filter(Boolean))];
  const refsFrom=strain=>unique([
    ...(strain.lineage?.sourceRefs||[]),
    ...(strain.aromas?.sourceRefs||[]),
    ...(strain.terpenes?.sourceRefs||[]),
    ...(strain.origin?.sourceRefs||[]),
    ...(strain.history?.sourceRefs||[]),
    ...(strain.relations||[]).flatMap(item=>item.sourceRefs||[])
  ]);

  const confidenceSummary=strain=>{
    const parts=[];
    const add=(label,section)=>{if(section?.confidence)parts.push(`${label} ${section.confidence}`);};
    add("LINEAGE",strain.lineage);
    add("AROMA",strain.aromas);
    add("TERPENE",strain.terpenes);
    add("ORIGIN",strain.origin);
    add("HISTORY",strain.history);
    return {display:parts.join(" / "),note:"各項目の確度は正本データのclaim-level confidenceを表示"};
  };

  const loadApp=()=>new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="app-v2.js?v=20260816-runtime";
    script.onload=resolve;
    script.onerror=reject;
    document.body.appendChild(script);
  });

  (async()=>{
    try{
      const response=await fetch("runtime/catalog.json?v=20260816",{cache:"no-store"});
      if(!response.ok)throw new Error(`runtime catalog ${response.status}`);
      const catalog=await response.json();
      const entities=Object.fromEntries((catalog.entities||[]).map(item=>[item.id,item]));

      window.SOURCES=Object.fromEntries((catalog.sources||[]).map(source=>[
        source.id,
        {
          name:source.publisher||source.title||source.id,
          url:source.url||"#",
          type:source.sourceType||"",
          typeLabel:SOURCE_TYPE_LABELS[source.sourceType]||source.sourceType||"SOURCE",
          checked:source.checkedAt||"",
          supports:source.supports||[]
        }
      ]));

      window.STRAINS=(catalog.cultivars||[]).map(strain=>{
        const breederRelation=(strain.relations||[]).find(item=>(item.roles||[]).includes("breeder"))||(strain.relations||[]).find(item=>(item.roles||[]).includes("seedCompany"));
        const breederEntity=breederRelation?entities[breederRelation.entityId]:null;
        const typeKey=strain.classification?.type||"unknown";
        return {
          id:strain.id,
          name:strain.name,
          jp:strain.jp||"",
          aliases:strain.aliases||[],
          identity:{scope:"cultivar",note:"品種一般の情報。特定ロット・製品・フェノタイプを示すものではありません。"},
          type:{key:typeKey,label:TYPE_LABELS[typeKey]||typeKey},
          lineage:{
            display:strain.lineage?.display||"",
            parents:strain.lineage?.parents||[],
            note:strain.lineage?.note||""
          },
          aromas:strain.aromas?.items||[],
          breeder:{name:breederEntity?.name||"",era:""},
          terpenes:strain.terpenes?.items||[],
          originHistory:strain.origin?.text||"",
          history:strain.history?.text||"",
          confidence:confidenceSummary(strain),
          visuals:(strain.visuals||[]).map(visual=>({
            ...visual,
            label:visual.role==="primary"?"VISUAL REFERENCE":visual.role==="aroma"?"AROMA VISUAL":String(visual.role||"VISUAL").toUpperCase()
          })),
          sourceIds:refsFrom(strain),
          reviews:[]
        };
      });

      await loadApp();
    }catch(error){
      console.error("Failed to load MASTER runtime catalog",error);
      const empty=document.getElementById("catalog-empty");
      if(empty){
        empty.textContent="品種データを読み込めませんでした。";
        empty.classList.add("is-visible");
      }
    }
  })();
})();

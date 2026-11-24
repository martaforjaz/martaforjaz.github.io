const get = id => document.getElementById(id);
const modes = {image:"Image",ocr:"OCR",fusion:"Image + OCR"};
let data, encoder, worker, token = 0, preview;

function terms(text) {
    return new Set(text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu,"")
        .match(/[a-z0-9]+/g)?.filter(word => /^\d+$/.test(word) ? word.length>=2 && word.length<=4 : word.length>1) || []);
}
function credit(product, side) {
    const link = document.createElement("a");
    link.href = product.urls[side];
    link.textContent = product.contributors[side] + " · Open Food Facts";
    return link;
}
function render(rank, truth, readText = '') {
    const seen = terms(readText);
    const indexedTerms = new Map(data.index.map(row => [row.i, row.tokens]));
    const columns = Object.entries(modes).map(([mode,name]) => {
        const col = document.createElement("div");
        const heading = document.createElement("h3");
        heading.textContent = name;
        col.append(heading);
        rank[mode].forEach((i,j) => {
            const item = data.products[i];
            const card = document.createElement("div");
            card.className = "card" + (truth===i?" hit":"");
            const image = new Image();
            image.src = `images/${item.code}-gallery.jpg`;
            image.alt = item.name;
            const copy = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = `${j+1}. ${item.name}`;
            const meta = document.createElement("small");
            meta.textContent = [item.brand,item.quantity,item.code].filter(Boolean).join(" · ");
            const source = document.createElement("small");
            source.append(credit(item,0));
            copy.append(name,meta,source);
            if(mode !== "image"){
                const overlap = (indexedTerms.get(i) || []).filter(word=>seen.has(word));
                if(overlap.length){
                    const evidence = document.createElement("small");
                    evidence.textContent = "Text match: " + overlap.join(", ");
                    copy.append(evidence);
                }
            }
            if(truth===i){
                const tag=document.createElement("small");
                tag.className="tag";tag.textContent="Exact barcode match";copy.append(tag);
            }
            card.append(image,copy);col.append(card);
        });
        return col;
    });
    get("columns").replaceChildren(...columns);
}
function query(source) {
    const image = get("query");
    image.src=source;
    image.hidden=false;
    return image;
}
function example(i) {
    ++token;
    const row=data.examples[i], item=data.products[row.i];
    query(`images/${item.code}-query.jpg`);
    get("query-credit").replaceChildren(credit(item,1));
    get("ocr").textContent="OCR: "+(row.text || "No text found");
    const found=data.index.some(entry=>entry.i===row.i);
    const accepts=row.confidence>data.report.threshold;
    const decision=accepts ? "Threshold passed" : "Needs confirmation · try a clearer photo or enter the barcode";
    get("status").textContent=(found ? "Known product" : "Product absent from catalog")+" · "+decision;
    render(row.rank,row.i,row.text);
}
async function upload(file) {
    const id=++token;
    if(!file || file.size>8_000_000){get("status").textContent="Select an image smaller than 8 MB.";return;}
    const previous=preview;
    preview=URL.createObjectURL(file);
    const image=query(preview);
    if(previous)URL.revokeObjectURL(previous);
    get("columns").replaceChildren();
    get("query-credit").replaceChildren();
    get("ocr").textContent="";
    get("status").textContent="Reading image and packaging text…";
    try {
        await image.decode();
        if(id!==token)return;
        const canvas=document.createElement("canvas");
        canvas.width=canvas.height=224;
        const ctx=canvas.getContext("2d");
        ctx.fillStyle="#eaf0f7";ctx.fillRect(0,0,224,224);
        const scale=Math.min(224/image.naturalWidth,224/image.naturalHeight);
        const w=Math.round(image.naturalWidth*scale),h=Math.round(image.naturalHeight*scale);
        ctx.drawImage(image,Math.floor((224-w)/2),Math.floor((224-h)/2),w,h);
        const rgba=ctx.getImageData(0,0,224,224).data, plane=224*224;
        const pixels=new Float32Array(3*plane);
        const mean=[.485,.456,.406], std=[.229,.224,.225];
        for(let c=0;c<3;c++)for(let j=0;j<plane;j++)pixels[c*plane+j]=(rgba[j*4+c]/255-mean[c])/std[c];
        ort.env.wasm.numThreads=1;
        encoder ??= ort.InferenceSession.create("mobilenet.onnx",{executionProviders:["wasm"]})
            .catch(error=>{encoder=undefined;throw error;});
        const model=await encoder;
        const result=await model.run({pixels:new ort.Tensor("float32",pixels,[1,3,224,224])});
        if(id!==token)return;
        let text="", readFailed=false;
        try {
            worker ??= Tesseract.createWorker("eng").catch(error=>{worker=undefined;throw error;});
            const engine=await worker;
            if(id!==token)return;
            text=(await engine.recognize(file,{}, {}, String(id))).data.text;
        } catch {readFailed=true;}
        if(id!==token)return;
        const vector=result.embedding.data, norm=Math.hypot(...vector)||1, words=terms(text);
        const scores=data.index.map(({i,vector:db,tokens})=>{
            const image=Math.max(0,Math.min(1,db.reduce((sum,x,j)=>sum+x*vector[j],0)/norm));
            const weight=token=>Object.hasOwn(data.weights,token)?data.weights[token]:0;
            const ocr=tokens.reduce((sum,t)=>sum+(words.has(t)?weight(t):0),0)/
                Math.max(1,tokens.reduce((sum,t)=>sum+weight(t),0));
            return {i,image,ocr,fusion:data.mix*image+(1-data.mix)*ocr};
        });
        const rank=Object.fromEntries(Object.keys(modes).map(mode=>[mode,[...scores].sort((a,b)=>b[mode]-a[mode]).slice(0,3).map(x=>x.i)]));
        get("ocr").textContent=readFailed?"OCR unavailable.":text.trim()?"OCR: "+text.trim():"No packaging text detected.";
        get("status").textContent=words.size && scores.some(row=>row.ocr>0)
            ? "Candidate variants · verify the barcode before confirming"
            : "Needs confirmation · try a clearer photo of the front or enter the barcode";
        if(!words.size){
            rank.ocr=[];
        }
        render(rank,null,text);
    } catch(error) {
        if(id===token)get("status").textContent="Image search failed. Try a different file or reload.";
        console.error(error);
    }
}
fetch("results.json?v=300").then(response=>{
    if(!response.ok)throw Error("Catalog unavailable");
    return response.json();
}).then(report=>{
    data=report;
    data.examples.forEach((entry,i)=>get("example").add(new Option(i===0?data.products[entry.i].name:"Product outside the catalog",i)));
    get("example").onchange=event=>example(Number(event.target.value));
    get("upload").onchange=event=>upload(event.target.files[0]);
    get("example").disabled=get("upload").disabled=false;
    const result=data.report;
    get("metrics").textContent=`${result.catalog} catalog products · ${result.known} known held-out queries · ${result.unknown} absent-product queries`;
    get("abstention").textContent=`The calibrated threshold accepted ${result.accepted} test queries, including ${result.incorrect_accepts} incorrect and ${result.unknown_accepts} absent products.`;
    example(0);
}).catch(()=>{get("status").textContent="Could not load the catalog.";});

get("barcode-form").onsubmit = event => {
    event.preventDefault();
    const code = get("barcode").value.trim();
    if (!/^[0-9]{8,14}$/.test(code)) return;
    const link = document.createElement("a");
    link.href = "https://world.openfoodfacts.org/product/" + code;
    link.textContent = "Open barcode " + code + " in Open Food Facts";
    get("barcode-result").replaceChildren(link);
};

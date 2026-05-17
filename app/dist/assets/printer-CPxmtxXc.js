import{t as e}from"./index-Be8VAxX_.js";var t={printBuffer:t=>{let n=document.createElement(`iframe`);n.style.position=`absolute`,n.style.width=`0px`,n.style.height=`0px`,n.style.border=`none`,n.style.visibility=`hidden`,document.body.appendChild(n);let r=n.contentWindow;if(!r){document.body.removeChild(n);return}let i=r.document;i.open();let a=``;a=t.mode===`Markdown Preview`?`<div class="markdown-body">${e.parse(t.getText())}</div>`:t.mode===`HTML Preview`?t.getText():`<pre>${t.getText().replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`)}</pre>`,i.write(`
            <html>
                <head>
                    <title>${t.name}</title>
                    
            <style>
                body {
                    font-family: "Consolas", "Courier New", monospace;
                    font-size: 12px;
                    line-height: 1.5;
                    color: #000;
                    margin: 20px;
                }
                pre {
                    white-space: pre-wrap; /* Wrap long lines */
                    word-wrap: break-word;
                    margin: 0;
                }
                /* Markdown specific styles override */
                .markdown-body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                    font-size: 14px;
                    line-height: 1.6;
                }
                .markdown-body h1, .markdown-body h2, .markdown-body h3 {
                    border-bottom: 1px solid #eaecef;
                    padding-bottom: .3em;
                }
                .markdown-body code {
                    font-family: "Consolas", monospace;
                    background-color: rgba(27,31,35,.05);
                    padding: .2em .4em;
                    border-radius: 3px;
                }
                .markdown-body pre {
                    background-color: #f6f8fa;
                    padding: 16px;
                    border-radius: 3px;
                    white-space: pre-wrap;
                }
                .markdown-body img {
                    max-width: 100%;
                }
                @media print {
                    /* Ensure content is not cut off */
                    body {
                        overflow: visible;
                        height: auto;
                    }
                }
            </style>
        
                </head>
                <body>
                    ${a}
                </body>
            </html>
        `),i.close();let o=()=>{document.body.contains(n)&&document.body.removeChild(n),window.removeEventListener(`focus`,o)};n.onload=()=>{r.focus(),r.print(),window.addEventListener(`focus`,o)}}};export{t as printer};
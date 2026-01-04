//@ts-check


/**
 * escapes a string so that HTML can not be injected that easy
 * (probally does not contain all edge-cases but is considerd sufficant for our use-case)
 * @param {string} value 
 * @returns 
 */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}



export const templates = {

    //@ts-ignore
    menuitem: vars => `
        <div class="menuitem" id="${vars.id}">
            <p>
                ${esc(vars.title)}
            </p>
        </div> 
    `,

    /** 
     * 
     * @param {{name: string, age: number}} vars
     */
    user: vars => `
        <div class="user">
            <span>${esc(vars.name)}</span>
            <span>${esc(vars.name)}</span>
        </div>
    `,

    /** 
     * @param {{year: number}} vars
     */
    footer: vars => `
        <footer>© ${vars.year}</footer>
    `
};
//@ts-check

export class SimulatedObject {

    name;
    id;
    static idnumber = 0;

    /** @type {HTMLElement} */
    root;

    /** @type {number} */
    x = 50;

    /** @type {number} */
    y = 50;

    /** @type {HTMLElement|null} */
    el = null;

    /**
     * 
     * @param {String} name 
     */
    constructor(name) {
        this.name = name;
        this.id = SimulatedObject.idnumber;
        SimulatedObject.idnumber++;
        this.root = document.createElement("div");
        this.root.classList.add("sim-object");
    }

    /**
     * 
     * @returns {HTMLElement}
     */
    render() {
        return this.root;
    }

    /**
      * @returns {HTMLElement}
      */
    renderIcon() {
        const root = document.createElement("div");
        root.className = "sim-node";
        root.style.left = this.x + "px";
        root.style.top = this.y + "px";

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = this.name;
        root.appendChild(title);

        const portL = document.createElement("div");
        portL.className = "sim-port left";
        portL.dataset.port = "left";
        root.appendChild(portL);

        const portR = document.createElement("div");
        portR.className = "sim-port right";
        portR.dataset.port = "right";
        root.appendChild(portR);

        this.el = root;
        return root;
    }

    /**
     * Port-Position in Workspace-Koordinaten
     * @param {"left"|"right"} which
     */
    getPortPosition(which) {
        if (!this.el) return { x: this.x, y: this.y };
        const port = this.el.querySelector(`.sim-port.${which}`);
        if (!(port instanceof HTMLElement)) {
            // fallback: center
            return { x: this.x + 55, y: this.y + 35 };
        }

        const r = port.getBoundingClientRect();
        // Achtung: wir rechnen später relativ zum Workspace um -> siehe SimControl
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

}
//@ts-check

export class SimulatedObject {

    name;
    id;

    /** @type {HTMLElement} */
    root;

    static idnumber=0;

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
}
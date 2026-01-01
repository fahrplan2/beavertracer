//@ts-check

export class Observable {

    /**
     * @type {Array<Observable>}
     */
    #observers = [];

    update() {
                
    }

    doUpdate() {
        this.#observers.forEach(obs => obs.update());
    }

    /**
     * 
     * @param {Observable} obj 
     */

    subscribe(obj) {
        this.#observers.push(obj);
    }

}
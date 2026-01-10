//@ts-check

export class Observable {

    /**
     * @type {Array<Observable>}
     */
    #observers = [];

    /**
     * dummy for consistency
     */
    update() {
       console.warn("Not implemented");
    }

    /**
     * calls all the observers
     */
    doUpdate() {
        this.#observers.forEach(obs => obs.update());
    }

    /**
     * subscribes to an object
     * @param {Observable} obj 
     */

    subscribe(obj) {
        this.#observers.push(obj);
    }

    /**
     * unsubscribs from an object
     * @param {Observable} obj 
     */
    unsubscribe(obj) {
        this.#observers = this.#observers.filter(elem => elem!=obj);
    }

}
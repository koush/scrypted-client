import { EventListener, ScryptedStatic, SystemManager, ScryptedDevice, EventDetails, EventListenerRegister, ScryptedDeviceType, EventListenerOptions, ScryptedInterfaceDescriptors, MediaManager, MediaObject, FFMpegInput, ScryptedInterface } from "@scrypted/sdk";
import { Socket, SocketOptions } from 'engine.io-client';
const Client = require('engine.io-client');
import axios from 'axios';

const allMethods: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.methods));
const allProperties: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.properties));
const deviceMethods: any[] = ['listen', 'setName', 'setRoom', 'setType'];

class ScryptedDeviceImpl implements ProxyHandler<object>, ScryptedDevice {
    session: ClientSession;
    constructor(session: ClientSession, id: string) {
        this.session = session;
        this.id = id;
    }

    setRoom(arg0: string): void {
        throw new Error("Method not implemented.");
    }

    listen(event: string | EventListenerOptions, callback: (eventSource: ScryptedDevice | null, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        var options: EventListenerOptions;
        if (event instanceof String) {
            options = {
                event: event as ScryptedInterface,
            }
        }
        else {
            options = event as EventListenerOptions;
        }
        var listenerId = Math.random().toString();
        this.session.listeners[listenerId] = callback;
        
        this.session.send({
            type: 'listen',
            listenerId,
            id: this.id,
            options,
        });

        const removeListener = () => {
            delete this.session.listeners[listenerId];
            this.session.send({
                type: 'removeListener',
                listenerId,
            });
        };

        return {
            removeListener,
        }
    }

    setName(name: string): void {
        throw new Error("Method not implemented.");
    }
    setType(type: ScryptedDeviceType): void {
        throw new Error("Method not implemented.");
    }
    id: string;

    get?(target: any, property: PropertyKey, receiver: any): any {
        const state = this.session.systemState[this.id];
        if (!state) {
            return undefined;
        }

        switch (property) {
            case "id":
                return this.id;
            case "interfaces":
            case "id":
            case "room":
            case "name":
            case "type":
            case "component":
            case "metadata":
                return state[property] && state[property].value;
        }

        if (allProperties.includes(property)) {
            const found = state[property];
            if (!found) {
                return undefined;
            }
            return found ? found.value : undefined;
        }

        if (deviceMethods.includes(property)) {
            return new Proxy(() => property, this);
        }

        if (!allMethods.includes(property)) {
            return undefined;
        }

        const interfaces: string[] = state.interfaces && state.interfaces.value;
        if (!interfaces) {
            return undefined;
        }

        const interfaceMethods: any[] = [].concat(...Object.values(ScryptedInterfaceDescriptors)
            .filter((type: any) => interfaces.includes(type.name))
            .map((type: any) => type.methods));

        if (!interfaceMethods.includes(property)) {
            return (this as any)[property];
        }

        return new Proxy(() => property, this);
    }

    apply?(target: any, thisArg: any, argArray?: any): any {
        if (deviceMethods.includes(target())) {
            return (this as any)[target()](...argArray);
        }

        if (target() == 'getVideoStream') {
            return {
                id: this.id,
                method: target(),
            };
        }
        else if (target() == 'takePicture') {
            return {
                id: this.id,
                method: target(),
            };
        }
        return this.session.rpc({
            type: 'method',
            id: this.id,
            method: target(),
            argArray,
        })
    }
}

class SystemManagerImpl implements SystemManager {
    session: ClientSession;

    constructor(session: ClientSession) {
        this.session = session;
    }
    getDeviceById(id: string): ScryptedDevice | null {
        const ret = this.session.systemState[id];
        if (!ret) {
            return null;
        }

        const device = new ScryptedDeviceImpl(this.session, id);
        return new Proxy(device, device);
    }
    getDeviceByName(name: string): ScryptedDevice | null {
        return null;
    }
    getDeviceState(id: string): object {
        throw new Error("Method not implemented.");
    }
    getSystemState(): object {
        // note: sending back reference is potentially wonky. but this allows
        // vue to turn this into a observable object.
        return this.session.systemState;
    }
    systemCall(method: string): Promise<any> {
        return this.session.rpc({
            type: 'system',
            method: method,
        });
    }
    listeners: any = {};
    listen(callback: (eventSource: ScryptedDevice | null, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        var listenerId = Math.random().toString();
        this.listeners[listenerId] = callback;
        const removeListener = () => delete this.listeners[listenerId];
        return {
            removeListener,
        }
    }
    handleIncomingMessage(message: any) {
        switch (message.type) {
            case 'listenEvent': {
                console.log(message);
                break;
            }
            case 'sync': {
                const { id, eventDetails, eventData }: { id: string, eventDetails: EventDetails, eventData: any } = message;
                if (eventDetails.property) {
                    const device = this.session.systemState[id] = this.session.systemState[id] || {};
                    var state = device[eventDetails.property] = device[eventDetails.property] || {};
                    state = Object.assign(state, {
                        stateTime: state.value !== eventData ? eventDetails.eventTime : state.lastEventTime,
                        lastEventTime: eventDetails.eventTime,
                        sourceInterface: eventDetails.eventInterface,
                        value: eventData,
                    });
                }
                for (var listener of Object.values(this.listeners)) {
                    try {
                        (listener as any)(this.getDeviceById(id), eventDetails, eventData);
                    }
                    catch (e) {
                        console.error('scrypted client: error in listener', e);
                    }
                }

                if (eventDetails.property === 'id' && !eventData) {
                    delete this.session.systemState[id];
                }
                break;
            }
        }
    }
}

class MediaManagerImpl implements MediaManager {
    session: ClientSession;

    constructor(session: ClientSession) {
        this.session = session;
    }
    convertMediaObjectToBuffer(mediaSource: MediaObject, toMimeType: string): Promise<Buffer> {
        return this.session.rpc({
            type: 'media',
            method: 'convertMediaObjectToBuffer',
            toMimeType,
            mediaSource,
        })
        .then(base64 => Buffer.from(base64, 'base64'));
    }
    _convertMediaObjectToUri(method: string, mediaSource: MediaObject, toMimeType: string): Promise<string> {
        return this.session.rpc({
            type: 'media',
            method,
            toMimeType,
            mediaSource,
        });
    }
    convertMediaObjectToLocalUrl(mediaObject: MediaObject, toMimeType: string): Promise<string> {
        return this._convertMediaObjectToUri('convertMediaObjectToLocalUri', mediaObject, toMimeType);
    }
    convertMediaObjectToUrl(mediaObject: MediaObject, toMimeType: string): Promise<string> {
        return this._convertMediaObjectToUri('convertMediaObjectToUri', mediaObject, toMimeType);
    }
    convertMediaObjectToUri(mediaObject: MediaObject, toMimeType: string): Promise<string> {
        return this.convertMediaObjectToLocalUrl(mediaObject, toMimeType);
    }
    convertMediaObjectToLocalUri(mediaObject: MediaObject, toMimeType: string): Promise<string> {
        return this.convertMediaObjectToLocalUrl(mediaObject, toMimeType);
    }
    createFFmpegMediaObject(ffMpegInput: FFMpegInput): MediaObject {
        throw new Error("Method not implemented.");
    }
    createMediaObject(data: string | Buffer | Promise<string | Buffer>, mimeType: string): MediaObject {
        throw new Error("Method not implemented.");
    }
    handleIncomingMessage(message: any) {
        switch (message.type) {
        }
    }
}

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
    rpc(method: string, ...args: any[]): Promise<any>;
    onClose?: Function;
}

class ClientSession {
    apiUrl: string;
    systemState: any;
    socket: Socket;
    pendingResults: any = {};
    listeners: any = {};

    send(data: any) {
        this.socket.send(JSON.stringify(data));
    }

    constructor(socket: Socket, apiUrl: string) {
        this.socket = socket;
        this.apiUrl = apiUrl;
    }

    rpc(options: any): Promise<any> {
        const resultId = Math.random().toString();
        this.send(Object.assign({
            resultId,
        }, options));
        return this.newPendingResult(resultId)
    }

    newPendingResult(resultId: string): Promise<any> {
        var result: any = this.pendingResults[resultId] = {};
        return new Promise<string>((resolve, reject) => {
            result.resolve = resolve;
            result.reject = reject;
        })
    }
    resolvePendingResult(resultId: string, result: any, error: any) {
        const promise = this.pendingResults[resultId];
        delete this.pendingResults[resultId];
        if (!promise) {
            return;
        }
        if (error === undefined) {
            promise.resolve(result);
        }
        else {
            promise.reject(new Error(error));
        }
    }
    handleIncomingMessage(message: any) {
        if (!message.resultId) {
            return;
        }
        const { resultId, error, result } = message;
        this.resolvePendingResult(resultId, result, error);
}
}

export default {
    connect(baseUrl: string): Promise<ScryptedClientStatic> {
        const rootLocation = baseUrl || `${window.location.protocol}//${window.location.host}`;
        const endpointPath = `/endpoint/@scrypted/core`;
        const endpointUrl = `${rootLocation}${endpointPath}`;
        const apiUrl = `${endpointUrl}/api`;

        return new Promise((resolve, reject) => {

            const options: SocketOptions = {
                path: `${endpointPath}/engine.io/`,
            };
            const socket = new Client(rootLocation, options);

            socket.on('open', async function () {
                try {

                    const session = new ClientSession(socket, apiUrl);
                    const systemManager = new SystemManagerImpl(session);
                    const mediaManager = new MediaManagerImpl(session);

                    socket.on('message', (message: any) => {
                        // console.log(message);
                        const json = JSON.parse(message);
                        session.handleIncomingMessage(json);
                        systemManager.handleIncomingMessage(json);
                        mediaManager.handleIncomingMessage(json);
                    });

                    var client: ScryptedClientStatic = {
                        systemManager,
                        mediaManager,
                        disconnect: socket.close.bind(socket),
                        rpc(method: string, ...args: any[]): Promise<any> {
                            return session.rpc({
                                type: 'rpc',
                                method,
                                args,
                            });
                        }
                    }

                    var systemState = await systemManager.systemCall('getSystemState');
                    session.systemState = systemState;

                    socket.on('close', () => {
                        if (client.onClose) {
                            client.onClose();
                        }
                    })

                    resolve(client);
                }
                catch (e) {
                    socket.close();
                    reject(e);
                }
            })
        });
    }
}

/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { InputBoxOptions, QuickPickItem as QuickPickItemExt } from '@theia/plugin';
import { interfaces } from 'inversify';
import {
    QuickOpenModel,
    QuickOpenItem,
    QuickOpenMode,
    QuickOpenItemOptions
} from '@theia/core/lib/browser/quick-open/quick-open-model';
import { RPCProtocol } from '../../api/rpc-protocol';
import {
    QuickOpenExt,
    QuickOpenMain,
    MAIN_RPC_CONTEXT,
    PickOptions,
    PickOpenItem,
    TransferInputBox,
    QuickInputTitleButtonHandle,
    TransferQuickPick
} from '../../api/plugin-api';
import { MonacoQuickOpenService } from '@theia/monaco/lib/browser/monaco-quick-open-service';
import { QuickInputService, FOLDER_ICON, FILE_ICON } from '@theia/core/lib/browser';
import { PluginSharedStyle } from './plugin-shared-style';
import URI from 'vscode-uri';
import { ThemeIcon, QuickInputButton } from '../../plugin/types-impl';
import { QuickPickService, QuickPickItem, QuickPickValue } from '@theia/core/lib/common/quick-pick-service';
import { QuickTitleBar } from '@theia/core/lib/browser/quick-open/quick-title-bar';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickTitleButtonSide } from '@theia/core/lib/common/quick-open-model';

export class QuickOpenMainImpl implements QuickOpenMain, QuickOpenModel {

    private quickInput: QuickInputService;
    private quickPick: QuickPickService;
    private quickTitleBar: QuickTitleBar;
    private doResolve: (value?: number | number[] | PromiseLike<number | number[]> | undefined) => void;
    private proxy: QuickOpenExt;
    private delegate: MonacoQuickOpenService;
    private acceptor: ((items: QuickOpenItem[]) => void) | undefined;
    private items: QuickOpenItem[] | undefined;

    private sharedStyle: PluginSharedStyle;

    private activeElement: HTMLElement | undefined;

    constructor(rpc: RPCProtocol, container: interfaces.Container) {
        this.proxy = rpc.getProxy(MAIN_RPC_CONTEXT.QUICK_OPEN_EXT);
        this.delegate = container.get(MonacoQuickOpenService);
        this.quickInput = container.get(QuickInputService);
        this.quickTitleBar = container.get(QuickTitleBar);
        this.quickPick = container.get(QuickPickService);
        this.sharedStyle = container.get(PluginSharedStyle);
    }

    private cleanUp() {
        this.items = undefined;
        this.acceptor = undefined;
        if (this.activeElement) {
            this.activeElement.focus();
        }
        this.activeElement = undefined;
    }

    $show(options: PickOptions): Promise<number | number[]> {
        this.activeElement = window.document.activeElement as HTMLElement;
        this.delegate.open(this, {
            fuzzyMatchDescription: options.matchOnDescription,
            fuzzyMatchLabel: true,
            fuzzyMatchDetail: options.matchOnDetail,
            placeholder: options.placeHolder,
            onClose: () => {
                this.cleanUp();
            }
        });

        return new Promise((resolve, reject) => {
            this.doResolve = resolve;
        });
    }

    // tslint:disable-next-line:no-any
    $setItems(items: PickOpenItem[]): Promise<any> {
        this.items = [];
        for (const i of items) {
            this.items.push(new QuickOpenItem({
                label: i.label,
                description: i.description,
                detail: i.detail,
                run: mode => {
                    if (mode === QuickOpenMode.OPEN) {
                        this.proxy.$onItemSelected(i.handle);
                        this.doResolve(i.handle);
                        this.cleanUp();
                        return true;
                    }
                    return false;
                }
            }));
        }
        if (this.acceptor) {
            this.acceptor(this.items);
        }
        return Promise.resolve();
    }

    private convertPickOpenItemToQuickOpenItem<T>(items: PickOpenItem[]): QuickPickItem<Object>[] {
        const convertedItems: QuickPickItem<Object>[] = [];
        for (const i of items) {
            convertedItems.push({
                label: i.label,
                description: i.description,
                detail: i.detail,
                type: i,
                value: i.label
            } as QuickPickValue<Object>);
        }
        return convertedItems;
    }

    // tslint:disable-next-line:no-any
    $setError(error: Error): Promise<any> {
        throw new Error('Method not implemented.');
    }

    $input(options: InputBoxOptions, validateInput: boolean): Promise<string | undefined> {
        if (validateInput) {
            options.validateInput = val => this.proxy.$validateInput(val);
        }

        return this.quickInput.open(options);
    }

    convertQuickInputButton(quickInputButton: QuickInputButton, index: number): QuickInputTitleButtonHandle {
        const currentIconPath = quickInputButton.iconPath;
        let newIcon = '';
        let newIconClass = '';
        if ('id' in currentIconPath || currentIconPath instanceof ThemeIcon) {
            newIconClass = this.resolveIconClassFromThemeIcon(currentIconPath);
        } else if (currentIconPath instanceof URI) {
            newIcon = currentIconPath.toString();
        } else {
            const { light, dark } = currentIconPath as { light: string | URI, dark: string | URI };
            const themedIconClasses = {
                light: light.toString(),
                dark: dark.toString()
            };
            newIconClass = this.sharedStyle.toIconClass(themedIconClasses);
        }

        const isDefaultQuickInputButton = 'id' in quickInputButton.iconPath && quickInputButton.iconPath.id === 'Back' ? true : false;
        return {
            icon: newIcon,
            iconClass: newIconClass,
            tooltip: quickInputButton.tooltip,
            side: isDefaultQuickInputButton ? QuickTitleButtonSide.LEFT : QuickTitleButtonSide.RIGHT,
            index: isDefaultQuickInputButton ? -1 : index
        };
    }

    private resolveIconClassFromThemeIcon(themeIconID: ThemeIcon): string {
        switch (themeIconID.id) {
            case 'folder': {
                return FOLDER_ICON;
            }
            case 'file': {
                return FILE_ICON;
            }
            case 'Back': {
                return 'fa fa-arrow-left';
            }
            default: {
                return '';
            }
        }
    }

    $showInputBox(inputBox: TransferInputBox, validateInput: boolean): void {
        if (validateInput) {
            inputBox.validateInput = val => this.proxy.$validateInput(val);
        }

        const quickInput = this.quickInput.open({
            busy: inputBox.busy,
            enabled: inputBox.enabled,
            ignoreFocusOut: inputBox.ignoreFocusOut,
            password: inputBox.password,
            step: inputBox.step,
            title: inputBox.title,
            totalSteps: inputBox.totalSteps,
            buttons: inputBox.buttons.map((btn, i) => this.convertQuickInputButton(btn, i)),
            validationMessage: inputBox.validationMessage,
            placeHolder: inputBox.placeholder,
            value: inputBox.value,
            prompt: inputBox.prompt,
            validateInput: inputBox.validateInput
        });

        const disposableListeners = new DisposableCollection();
        disposableListeners.push(this.quickInput.onDidAccept(() => this.proxy.$acceptOnDidAccept(inputBox.quickInputIndex)));
        disposableListeners.push(this.quickInput.onDidChangeValue(changedText => this.proxy.$acceptDidChangeValue(inputBox.quickInputIndex, changedText)));
        disposableListeners.push(this.quickTitleBar.onDidTriggerButton(button => {
            this.proxy.$acceptOnDidTriggerButton(inputBox.quickInputIndex, button);
        }));
        quickInput.then(selection => {
            if (selection) {
                this.proxy.$acceptDidChangeSelection(inputBox.quickInputIndex, selection as string);
            }
            this.proxy.$acceptOnDidHide(inputBox.quickInputIndex);
            disposableListeners.dispose();
        });
    }

    // tslint:disable-next-line:no-any
    private findChangedKey(key: string, value: any): void {
        switch (key) {
            case 'title': {
                this.quickTitleBar.title = value;
                break;
            }
            case 'step': {
                this.quickTitleBar.step = value;
                break;
            }
            case 'totalSteps': {
                this.quickTitleBar.totalSteps = value;
                break;
            }
            case 'buttons': {
                this.quickTitleBar.buttons = value;
                break;
            }
            case 'value': {
                this.delegate.setValue(value);
                break;
            }
            case 'enabled': {
                this.delegate.setEnabled(value);
                break;
            }
            case 'password': {
                this.delegate.setPassword(value);
                break;
            }
            case 'placeholder': {
                this.delegate.setPlaceHolder(value);
                break;
            }
            case 'items': {
                this.quickPick.setItems(value.map((options: QuickOpenItemOptions) => new QuickOpenItem(options)));
                break;
            }
        }
    }

    // tslint:disable-next-line:no-any
    $setQuickInputChanged(changed: any): void {
        for (const key in changed) {
            if (changed.hasOwnProperty(key)) {
                const value = changed[key];
                this.findChangedKey(key, value);
            }
        }
    }
    $refreshQuickInput(): void {
        this.quickInput.refresh();
    }

    $showCustomQuickPick<T extends QuickPickItemExt>(options: TransferQuickPick<T>): void {
        const items = this.convertPickOpenItemToQuickOpenItem(options.items);
        const quickPick = this.quickPick.show(items, {
            buttons: options.buttons.map((btn, i) => this.convertQuickInputButton(btn, i)),
            placeholder: options.placeholder,
            fuzzyMatchDescription: options.matchOnDescription,
            fuzzyMatchLabel: true,
            step: options.step,
            title: options.title,
            totalSteps: options.totalSteps,
            ignoreFocusOut: options.ignoreFocusOut,
            value: options.value
        });

        const disposableListeners = new DisposableCollection();
        disposableListeners.push(this.quickPick.onDidAccept(() => this.proxy.$acceptOnDidAccept(options.quickInputIndex)));
        disposableListeners.push(this.quickPick.onDidChangeActiveItems(changedItems => this.proxy.$acceptDidChangeActive(options.quickInputIndex, changedItems)));
        disposableListeners.push(this.quickPick.onDidChangeValue(value => this.proxy.$acceptDidChangeValue(options.quickInputIndex, value)));
        disposableListeners.push(this.quickTitleBar.onDidTriggerButton(button => {
            this.proxy.$acceptOnDidTriggerButton(options.quickInputIndex, button);
        }));
        quickPick.then(selection => {
            if (selection) {
                this.proxy.$acceptDidChangeSelection(options.quickInputIndex, selection as string);
            }
            this.proxy.$acceptOnDidHide(options.quickInputIndex);
            disposableListeners.dispose();
        });
    }

    onType(lookFor: string, acceptor: (items: QuickOpenItem[]) => void): void {
        this.acceptor = acceptor;
        if (this.items) {
            acceptor(this.items);
        }
    }

    $hide(): void {
        this.delegate.hide();
    }

}

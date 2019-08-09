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

import { interfaces } from 'inversify';
import { KeysToKeysToAnyValue } from '../../common/types';
import { FileStat } from '@theia/filesystem/lib/common/filesystem';
import { ExtPluginApi } from '../../common/plugin-ext-api-contribution';
import { PluginMetadata } from '../../common/plugin-protocol';

export type DebugActivationEvent = 'onDebugResolve' | 'onDebugInitialConfigurations' | 'onDebugAdapterProtocolTracker';

export const MainPluginService = Symbol('MainPluginService');
export interface MainPluginService {
    checkAndLoadPlugin(container: interfaces.Container): void;
    initPlugins(): void;
    loadPlugins(initData: PluginsInitializationData, container: interfaces.Container): Promise<void>
    activateByEvent(activationEvent: string): Promise<void>;
    activateByView(viewId: string): Promise<void>;
    activateByLanguage(languageId: string): Promise<void>;
    activateByCommand(commandId: string): Promise<void>;
    activateByDebug(activationEvent?: DebugActivationEvent, debugType?: string): Promise<void>;
}

export interface PluginsInitializationData {
    plugins: PluginMetadata[],
    logPath: string,
    storagePath: string | undefined,
    pluginAPIs: ExtPluginApi[],
    globalStates: KeysToKeysToAnyValue,
    workspaceStates: KeysToKeysToAnyValue,
    roots: FileStat[],
}

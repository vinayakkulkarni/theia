/********************************************************************************
 * Copyright (C) 2017-2018 Ericsson and others.
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

import { inject, injectable } from 'inversify';
import { ContributedTaskConfiguration, TaskConfiguration, TaskCustomization, TaskDefinition } from '../common';
import { TaskDefinitionRegistry } from './task-definition-registry';
import { ProvidedTaskConfigurations } from './provided-task-configurations';
import { Disposable, DisposableCollection, ResourceProvider } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { FileSystemWatcher, FileChangeEvent } from '@theia/filesystem/lib/browser/filesystem-watcher';
import { FileChange, FileChangeType } from '@theia/filesystem/lib/common/filesystem-watcher-protocol';
import { FileSystem } from '@theia/filesystem/lib/common';
import * as jsoncparser from 'jsonc-parser';
import { ParseError } from 'jsonc-parser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { open, OpenerService } from '@theia/core/lib/browser';
import { Resource } from '@theia/core';

export interface TaskConfigurationClient {
    /**
     * The task configuration file has changed, so a client might want to refresh its configurations
     * @returns an array of strings, each one being a task label
     */
    taskConfigurationChanged: (event: string[]) => void;
}

/**
 * Watches a tasks.json configuration file and provides a parsed version of the contained task configurations
 */
@injectable()
export class TaskConfigurations implements Disposable {

    protected readonly toDispose = new DisposableCollection();
    /**
     * Map of source (path of root folder that the task configs come from) and task config map.
     * For the inner map (i.e., task config map), the key is task label and value TaskConfiguration
     */
    protected tasksMap = new Map<string, Map<string, TaskConfiguration>>();
    /**
     * Map of source (path of root folder that the task configs come from) and task customizations map.
     */
    protected taskCustomizationMap = new Map<string, TaskCustomization[]>();

    protected watchedConfigFileUris: string[] = [];
    protected watchersMap = new Map<string, Disposable>(); // map of watchers for task config files, where the key is folder uri

    /** last directory element under which we look for task config */
    protected readonly TASKFILEPATH = '.theia';
    /** task configuration file name */
    protected readonly TASKFILE = 'tasks.json';

    protected client: TaskConfigurationClient | undefined = undefined;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(ResourceProvider)
    protected readonly resourceProvider: ResourceProvider;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(TaskDefinitionRegistry)
    protected readonly taskDefinitionRegistry: TaskDefinitionRegistry;

    @inject(ProvidedTaskConfigurations)
    protected readonly providedTaskConfigurations: ProvidedTaskConfigurations;

    constructor(
        @inject(FileSystemWatcher) protected readonly watcherServer: FileSystemWatcher,
        @inject(FileSystem) protected readonly fileSystem: FileSystem
    ) {
        this.toDispose.push(watcherServer);
        this.watcherServer.onFilesChanged(async changes => {
            try {
                const watchedConfigFileChanges = changes.filter(change =>
                    this.watchedConfigFileUris.some(fileUri => FileChangeEvent.isAffected([change], new URI(fileUri)))
                ).map(relatedChange => (
                    { uri: relatedChange.uri.toString(), type: relatedChange.type }
                ));
                if (watchedConfigFileChanges.length >= 0) {
                    await this.onDidTaskFileChange(watchedConfigFileChanges);
                    if (this.client) {
                        this.client.taskConfigurationChanged(this.getTaskLabels());
                    }
                }
            } catch (err) {
                console.error(err);
            }
        });

        this.toDispose.push(Disposable.create(() => {
            this.tasksMap.clear();
            this.client = undefined;
        }));
    }

    setClient(client: TaskConfigurationClient): void {
        this.client = client;
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    get configFileUris(): string[] {
        return this.watchedConfigFileUris;
    }

    /**
     * Triggers the watching of a potential task configuration file, under the given root URI.
     * Returns whether a configuration file was found.
     */
    async watchConfigurationFile(rootUri: string): Promise<boolean> {
        const configFileUri = this.getConfigFileUri(rootUri);
        if (!this.watchedConfigFileUris.some(uri => uri === configFileUri)) {
            this.watchedConfigFileUris.push(configFileUri);
            const disposableWatcher = await this.watcherServer.watchFileChanges(new URI(configFileUri));
            const disposable = Disposable.create(() => {
                disposableWatcher.dispose();
                this.watchersMap.delete(configFileUri);
                const ind = this.watchedConfigFileUris.findIndex(uri => uri === configFileUri);
                if (ind >= 0) {
                    this.watchedConfigFileUris.splice(ind, 1);
                }
            });
            this.watchersMap.set(configFileUri, disposable);
            this.toDispose.push(disposable);
            this.refreshTasks(configFileUri);
        }

        if (await this.fileSystem.exists(configFileUri)) {
            return true;
        } else {
            console.info(`Config file ${this.TASKFILE} does not exist under ${rootUri}`);
            return false;
        }
    }

    /**
     * Stops watchers added to a potential task configuration file.
     * Returns whether a configuration file was being watched before this function gets called.
     */
    unwatchConfigurationFile(configFileUri: string): boolean {
        if (!this.watchersMap.has(configFileUri)) {
            return false;
        }
        this.watchersMap.get(configFileUri)!.dispose();
        return true;
    }

    /** returns the list of known task labels */
    getTaskLabels(): string[] {
        return Array.from(this.tasksMap.values()).reduce((acc, labelConfigMap) => acc.concat(Array.from(labelConfigMap.keys())), [] as string[]);
    }

    /**
     * returns the list of known tasks, which includes:
     * - all the configured tasks in `tasks.json`, and
     * - the customized detected tasks
     */
    async getTasks(): Promise<TaskConfiguration[]> {
        const configuredTasks = Array.from(this.tasksMap.values()).reduce((acc, labelConfigMap) => acc.concat(Array.from(labelConfigMap.values())), [] as TaskConfiguration[]);
        const detectedTasksAsConfigured: TaskConfiguration[] = [];
        for (const [rootFolder, customizations] of Array.from(this.taskCustomizationMap.entries())) {
            for (const cus of customizations) {
                const detected = await this.providedTaskConfigurations.getTaskToCustomize(cus, rootFolder);
                if (detected) {
                    detectedTasksAsConfigured.push(detected);
                }
            }
        }
        return [...configuredTasks, ...detectedTasksAsConfigured];
    }

    /** returns the task configuration for a given label or undefined if none */
    getTask(rootFolderPath: string, taskLabel: string): TaskConfiguration | undefined {
        const labelConfigMap = this.tasksMap.get(rootFolderPath);
        if (labelConfigMap) {
            return labelConfigMap.get(taskLabel);
        }
    }

    /** removes tasks configured in the given task config file */
    removeTasks(configFileUri: string): void {
        const source = this.getSourceFolderFromConfigUri(configFileUri);
        this.tasksMap.delete(source);
    }

    /**
     * Removes task customization objects found in the given task config file from the memory.
     * Please note: this function does not modify the task config file.
     */
    removeTaskCustomizations(configFileUri: string): void {
        const source = this.getSourceFolderFromConfigUri(configFileUri);
        this.taskCustomizationMap.delete(source);
    }

    /**
     * Returns the task customizations by type from a given root folder in the workspace.
     * @param type the type of task customizations
     * @param rootFolder the root folder to find task customizations from. If `undefined`, this function returns an empty array.
     */
    getTaskCustomizations(type: string, rootFolder?: string): TaskCustomization[] {
        if (!rootFolder) {
            return [];
        }

        const customizationInRootFolder = this.taskCustomizationMap.get(new URI(rootFolder).path.toString());
        if (customizationInRootFolder) {
            return customizationInRootFolder.filter(c => c.type === type);
        }
        return [];
    }

    /**
     * Returns the customization object in `tasks.json` for the given task. Please note, this function
     * returns `undefined` if the given task is not a detected task, because configured tasks don't need
     * customization objects - users can modify its config directly in `tasks.json`.
     * @param taskConfig The task config, which could either be a configured task or a detected task.
     */
    getCustomizationForTask(taskConfig: TaskConfiguration): TaskCustomization | undefined {
        if (!this.isDetectedTask(taskConfig)) {
            return undefined;
        }

        const customizationByType = this.getTaskCustomizations(taskConfig.taskType || taskConfig.type, taskConfig._scope) || [];
        const hasCustomization = customizationByType.length > 0;
        if (hasCustomization) {
            const taskDefinition = this.taskDefinitionRegistry.getDefinition(taskConfig);
            if (taskDefinition) {
                const cus = customizationByType.filter(customization =>
                    taskDefinition.properties.required.every(rp => customization[rp] === taskConfig[rp])
                )[0]; // Only support having one customization per task
                return cus;
            }
        }
        return undefined;
    }

    /** returns the string uri of where the config file would be, if it existed under a given root directory */
    protected getConfigFileUri(rootDir: string): string {
        return new URI(rootDir).resolve(this.TASKFILEPATH).resolve(this.TASKFILE).toString();
    }

    /**
     * Called when a change, to a config file we watch, is detected.
     * Triggers a reparse, if appropriate.
     */
    protected async onDidTaskFileChange(fileChanges: FileChange[]): Promise<void> {
        for (const change of fileChanges) {
            if (change.type === FileChangeType.DELETED) {
                this.removeTasks(change.uri);
            } else {
                // re-parse the config file
                await this.refreshTasks(change.uri);
            }
        }
    }

    /**
     * Tries to read the tasks from a config file and if it successes then updates the list of available tasks.
     * If reading a config file wasn't successful then does nothing.
     */
    protected async refreshTasks(configFileUri: string): Promise<void> {
        const tasksArray = await this.readTasks(configFileUri);
        if (tasksArray) {
            const configuredTasksArray: TaskConfiguration[] = [];
            const customizations: TaskCustomization[] = [];

            await this.taskDefinitionRegistry.ready;
            tasksArray.forEach(t => {
                if (this.isDetectedTask(t)) {
                    customizations.push(t);
                } else {
                    configuredTasksArray.push(t);
                }
            });

            // only clear tasks map when successful at parsing the config file
            // this way we avoid clearing and re-filling it multiple times if the
            // user is editing the file in the auto-save mode, having momentarily
            // non-parsing JSON.
            this.removeTasks(configFileUri);
            this.removeTaskCustomizations(configFileUri);
            const rootFolderUri = this.getSourceFolderFromConfigUri(configFileUri);

            if (configuredTasksArray.length > 0) {
                const newTaskMap = new Map<string, TaskConfiguration>();
                for (const task of configuredTasksArray) {
                    newTaskMap.set(task.label, task);
                }
                this.tasksMap.set(rootFolderUri, newTaskMap);
            }

            if (customizations.length > 0) {
                this.taskCustomizationMap.set(rootFolderUri, customizations);
            }
        }
    }

    /** parses a config file and extracts the tasks launch configurations */
    protected async readTasks(uri: string): Promise<TaskConfiguration[] | undefined> {
        if (!await this.fileSystem.exists(uri)) {
            return undefined;
        } else {
            try {
                const response = await this.fileSystem.resolveContent(uri);

                const strippedContent = jsoncparser.stripComments(response.content);
                const errors: ParseError[] = [];
                const tasks = jsoncparser.parse(strippedContent, errors);

                if (errors.length) {
                    for (const e of errors) {
                        console.error(`Error parsing ${uri}: error: ${e.error}, length:  ${e.length}, offset:  ${e.offset}`);
                    }
                } else {
                    return this.filterDuplicates(tasks['tasks']).map(t => Object.assign(t, { _source: t.source || this.getSourceFolderFromConfigUri(uri) }));
                }
            } catch (err) {
                console.error(`Error(s) reading config file: ${uri}`);
            }
        }
    }

    /** Adds given task to a config file and opens the file to provide ability to edit task configuration. */
    async configure(task: TaskConfiguration): Promise<void> {
        const workspace = this.workspaceService.workspace;
        if (!workspace) {
            return;
        }

        const isDetectedTask = this.isDetectedTask(task);
        let sourceFolderUri: string | undefined;
        if (isDetectedTask) {
            sourceFolderUri = task._scope;
        } else {
            sourceFolderUri = task._source;
        }
        if (!sourceFolderUri) {
            console.error('Global task cannot be customized');
            return;
        }

        const configFileUri = this.getConfigFileUri(sourceFolderUri);
        const configuredAndCustomizedTasks = await this.getTasks();
        if (!configuredAndCustomizedTasks.some(t => ContributedTaskConfiguration.equals(t, task))) {
            await this.saveTask(configFileUri, task);
        }

        try {
            await open(this.openerService, new URI(configFileUri));
        } catch (e) {
            console.error(`Error occurred while opening: ${this.TASKFILE}.`, e);
        }
    }

    private getTaskCustomizationTemplate(task: TaskConfiguration): TaskCustomization | undefined {
        const definition = this.getTaskDefinition(task);
        if (!definition) {
            console.error('Detected / Contributed tasks should have a task definition.');
            return;
        }
        const customization: TaskCustomization = { type: task.taskType || task.type };
        definition.properties.all.forEach(p => {
            if (task[p] !== undefined) {
                customization[p] = task[p];
            }
        });
        return {
            ...customization,
            problemMatcher: []
        };
    }

    /** Writes the task to a config file. Creates a config file if this one does not exist */
    async saveTask(configFileUri: string, task: TaskConfiguration): Promise<void> {
        if (configFileUri && !await this.fileSystem.exists(configFileUri)) {
            await this.fileSystem.createFile(configFileUri);
        }

        const { _source, $ident, ...preparedTask } = task;
        const customizedTaskTemplate = this.getTaskCustomizationTemplate(task) || preparedTask;
        try {
            const response = await this.fileSystem.resolveContent(configFileUri);
            const content = response.content;

            const formattingOptions = { tabSize: 4, insertSpaces: true, eol: '' };
            const edits = jsoncparser.modify(content, ['tasks', -1], customizedTaskTemplate, { formattingOptions });
            const result = jsoncparser.applyEdits(content, edits);

            const resource = await this.resourceProvider(new URI(configFileUri));
            Resource.save(resource, { content: result });
        } catch (e) {
            const message = `Failed to save task configuration for ${task.label} task.`;
            console.error(`${message} ${e.toString()}`);
            return;
        }
    }

    protected filterDuplicates(tasks: TaskConfiguration[]): TaskConfiguration[] {
        const filteredTasks: TaskConfiguration[] = [];
        for (const task of tasks) {
            if (filteredTasks.some(t => !this.isDetectedTask(t) && t.label === task.label)) {
                // TODO: create a problem marker so that this issue will be visible in the editor?
                console.error(`Error parsing ${this.TASKFILE}: found duplicate entry for label: ${task.label}`);
            } else {
                filteredTasks.push(task);
            }
        }
        return filteredTasks;
    }

    private getSourceFolderFromConfigUri(configFileUri: string): string {
        return new URI(configFileUri).parent.parent.path.toString();
    }

    /** checks if the config is a detected / contributed task */
    private isDetectedTask(task: TaskConfiguration): task is ContributedTaskConfiguration {
        const taskDefinition = this.getTaskDefinition(task);
        // it is considered as a customization if the task definition registry finds a def for the task configuration
        return !!taskDefinition;
    }

    private getTaskDefinition(task: TaskConfiguration): TaskDefinition | undefined {
        return this.taskDefinitionRegistry.getDefinition({
            ...task,
            type: task.taskType || task.type
        });
    }
}

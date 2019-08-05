/********************************************************************************
 * Copyright (C) 2018 Ericsson and others.
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

import * as React from 'react';
import URI from '@theia/core/lib/common/uri';
import { injectable, inject, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry, isOSX, environment } from '@theia/core/lib/common';
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser';
import { FileStat, FileSystem } from '@theia/filesystem/lib/common/filesystem';
import { KeymapsCommands } from '@theia/keymaps/lib/browser';
import { CommonCommands, LabelProvider } from '@theia/core/lib/browser';
import { ApplicationInfo, ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { FileSystemUtils } from '@theia/filesystem/lib/common/filesystem-utils';

@injectable()
export class GettingStartedWidget extends ReactWidget {

    /**
     * The widget `id`.
     */
    static readonly ID = 'getting.started.widget';
    /**
     * The widget `label` for display purposes.
     */
    static readonly LABEL = 'Getting Started';

    /**
     * The `ApplicationInfo` for the application.
     * Used in order to determine the application's version number if applicable.
     */
    protected applicationInfo: ApplicationInfo | undefined;
    /**
     * The application's name for display purposes.
     */
    protected applicationName = FrontendApplicationConfigProvider.get().applicationName;

    protected stat: FileStat | undefined;
    protected home: string | undefined;

    /**
     * The amount of recent workspaces to display.
     */
    protected recentLimit = 5;
    /**
     * The list of recently used workspaces.
     */
    protected recentWorkspaces: string[] = [];

    /**
     * Collection of useful links to display.
     */
    protected links: Map<string, string> = new Map<string, string>();

    @inject(ApplicationServer)
    protected readonly appServer: ApplicationServer;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(FileSystem)
    protected readonly fileSystem: FileSystem;

    @inject(LabelProvider)
    protected readonly labelProvider: LabelProvider;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @postConstruct()
    protected async init(): Promise<void> {
        this.id = GettingStartedWidget.ID;
        this.title.label = GettingStartedWidget.LABEL;
        this.title.caption = GettingStartedWidget.LABEL;
        this.title.closable = true;

        this.applicationInfo = await this.appServer.getApplicationInfo();
        this.recentWorkspaces = await this.workspaceService.recentWorkspaces();
        this.stat = await this.fileSystem.getCurrentUserHome();
        this.home = this.stat ? new URI(this.stat.uri).path.toString() : undefined;
        this.setLinks();
        this.update();
    }

    /**
     * Render the content of the widget.
     */
    protected render(): React.ReactNode {
        return <div className='gs-container'>
            {this.renderHeader()}
            <hr className='gs-hr' />
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderOpen()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderRecentWorkspaces()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderSettings()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderHelp()}
                </div>
            </div>
            <div className='flex-grid'>
                <div className='col'>
                    {this.renderVersion()}
                </div>
            </div>
        </div>;
    }

    /**
     * Render the main widget header including the title.
     */
    protected renderHeader(): React.ReactNode {
        return <div className='gs-header'>
            <h1>{this.applicationName}<span className='gs-sub-header'> Getting Started</span></h1>
        </div>;
    }

    /**
     * Render the open section.
     * The section includes displaying `open` commands.
     */
    protected renderOpen(): React.ReactNode {
        const requireSingleOpen = isOSX || !environment.electron.is();
        const open = requireSingleOpen && <div className='gs-action-container'><a href='#' onClick={this.doOpen}>Open</a></div>;
        const openFile = !requireSingleOpen && <div className='gs-action-container'><a href='#' onClick={this.doOpenFile}>Open File</a></div>;
        const openFolder = !requireSingleOpen && <div className='gs-action-container'><a href='#' onClick={this.doOpenFolder}>Open Folder</a></div>;
        const openWorkspace = <a href='#' onClick={this.doOpenWorkspace}>Open Workspace</a>;
        return <div className='gs-section'>
            <h3 className='gs-section-header'><i className='fa fa-folder-open'></i>Open</h3>
            {open}
            {openFile}
            {openFolder}
            {openWorkspace}
        </div>;
    }

    /**
     * Render the recently used workspaces section.
     * List the recently used workspaces and upon selection
     * open the workspace.
     */
    protected renderRecentWorkspaces(): React.ReactNode {
        const items: string[] = this.recentWorkspaces;
        const paths: string[] = this.buildPaths(items);
        const content = paths.slice(0, this.recentLimit).map((item, index) =>
            <div className='gs-action-container' key={index}>
                <a href='#' onClick={a => this.open(new URI(items[index]))}>{new URI(items[index]).path.base}</a>
                <span className='gs-action-details'>
                    {item}
                </span>
            </div>
        );
        const more = paths.length > this.recentLimit && <div className='gs-action-container'><a href='#' onClick={this.doOpenRecentWorkspace}>More...</a></div>;
        return <div className='gs-section'>
            <h3 className='gs-section-header'>
                <i className='fa fa-clock-o'></i>Recent Workspaces
            </h3>
            {items.length > 0 ? content : <p className='gs-no-recent'>No Recent Workspaces</p>}
            {more}
        </div>;
    }

    /**
     * Render the settings section which displays commands to open
     * settings specific items.
     */
    protected renderSettings(): React.ReactNode {
        return <div className='gs-section'>
            <h3 className='gs-section-header'>
                <i className='fa fa-cog'></i>
                Settings
            </h3>
            <div className='gs-action-container'>
                <a href='#' onClick={this.doOpenPreferences}>Open Preferences</a>
            </div>
            <div className='gs-action-container'>
                <a href='#' onClick={this.doOpenKeyboardShortcuts}>Open Keyboard Shortcuts</a>
            </div>
        </div>;
    }

    /**
     * Render the help section which displays useful links.
     */
    protected renderHelp(): React.ReactNode {
        const links = Array.from(this.links).map((link, index) =>
            <div key={index} className='gs-action-container'>
                <a href={link[1]} target='_blank'>{link[0]}</a>
            </div>
        );
        return <div className='gs-section'>
            <h3 className='gs-section-header'>
                <i className='fa fa-question-circle'></i>
                Help
            </h3>
            {links}
        </div>;
    }

    /**
     * Render the version section.
     */
    protected renderVersion(): React.ReactNode {
        return <div className='gs-section'>
            <div className='gs-action-container'>
                <p className='gs-sub-header' >
                    {this.applicationInfo ? 'Version ' + this.applicationInfo.version : ''}
                </p>
            </div>
        </div>;
    }

    /**
     * Get the list of workspace paths for display purposes.
     * @param workspaces the list of workspaces.
     * @returns a list of workspace paths.
     */
    protected buildPaths(workspaces: string[]): string[] {
        const paths: string[] = [];
        workspaces.forEach(workspace => {
            const uri = new URI(workspace);
            const pathLabel = this.labelProvider.getLongName(uri);
            const path = this.home ? FileSystemUtils.tildifyPath(pathLabel, this.home) : pathLabel;
            paths.push(path);
        });
        return paths;
    }

    /**
     * Set the list of links.
     */
    protected setLinks(): void {
        // The default implementation sets useful links which point to documentation.
        this.links.set('Documentation', 'https://www.theia-ide.org/doc/');
        this.links.set('Building an Extension', 'https://www.theia-ide.org/doc/Authoring_Extensions.html');
        this.links.set('Building a New Plugin', 'https://www.theia-ide.org/doc/Authoring_Plugins.html');
    }

    /**
     * Trigger the open dialog.
     */
    protected doOpen = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN.id);
    /**
     * Trigger the open file dialog.
     */
    protected doOpenFile = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_FILE.id);
    /**
     * Trigger the open folder dialog.
     */
    protected doOpenFolder = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_FOLDER.id);
    /**
     * Trigger the open workspace dialog.
     */
    protected doOpenWorkspace = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_WORKSPACE.id);
    /**
     * Trigger opening the recent workspaces quick-open menu.
     */
    protected doOpenRecentWorkspace = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_RECENT_WORKSPACE.id);
    /**
     * Trigger opening the preferences widget.
     */
    protected doOpenPreferences = () => this.commandRegistry.executeCommand(CommonCommands.OPEN_PREFERENCES.id);
    /**
     * Trigger opening the keyboard shortcuts widget.
     */
    protected doOpenKeyboardShortcuts = () => this.commandRegistry.executeCommand(KeymapsCommands.OPEN_KEYMAPS.id);
    /**
     * Open a given workspace.
     * @param uri {URI} the workspace uri.
     */
    protected open = (uri: URI) => this.workspaceService.open(uri);
}

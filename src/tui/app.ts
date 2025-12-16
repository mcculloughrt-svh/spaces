/**
 * Main TUI application
 * Two-panel layout with projects on left, workspaces on right
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
  type CliRenderer,
} from '@opentui/core';
import {
  createInitialState,
  loadProjects,
  loadWorkspaces,
  stateReducer,
  type AppState,
  type StateAction,
} from './state.js';
import { setCurrentProject, getProjectWorkspacesDir, readProjectConfig } from '../core/config.js';
import { openWorkspaceShell } from '../core/shell.js';
import { addWorkspace } from '../commands/add.js';
import { removeWorkspace } from '../commands/remove.js';
import { join } from 'path';
import { spawnSync } from 'child_process';

// Colors
const COLORS = {
  border: '#555555',
  borderFocused: '#00AAFF',
  text: '#FFFFFF',
  textDim: '#888888',
  selected: '#00AAFF',
  title: '#00FF88',
  statusBar: '#333333',
  stale: '#FF8800',
  // Gradient colors for ASCII art
  gradient1: '#00FFFF', // Cyan
  gradient2: '#00DDFF',
  gradient3: '#00BBFF',
  gradient4: '#0099FF',
  gradient5: '#0077FF',
  gradient6: '#0055FF', // Blue
  asciiBox: '#444466',
  subtitle: '#888899',
};

type DialogMode = 'none' | 'new-workspace' | 'confirm-delete' | 'help' | 'workspace-actions';

export class SpacesTUI {
  private renderer!: CliRenderer;
  private state: AppState;
  private isRunning = false;
  private dialogMode: DialogMode = 'none';
  private pendingDelete: { type: 'workspace'; name: string } | null = null;
  private pendingWorkspaceAction: { projectName: string; workspaceName: string } | null = null;

  // Layout containers
  private root!: BoxRenderable;
  private header!: BoxRenderable;
  private mainContent!: BoxRenderable;
  private projectPanel!: BoxRenderable;
  private workspacePanel!: BoxRenderable;
  private statusBar!: BoxRenderable;

  // Content elements
  private projectSelect!: SelectRenderable;
  private workspaceSelect!: SelectRenderable;
  private statusText!: TextRenderable;
  private projectTitle!: TextRenderable;
  private workspaceTitle!: TextRenderable;
  private emptyWorkspaceText!: TextRenderable;

  // Dialog elements
  private dialogOverlay!: BoxRenderable;
  private dialogBox!: BoxRenderable;
  private dialogTitle!: TextRenderable;
  private dialogInput!: InputRenderable;
  private dialogMessage!: TextRenderable;
  private dialogHint!: TextRenderable;

  constructor() {
    this.state = createInitialState();
  }

  /**
   * Start the TUI application
   */
  async start(): Promise<void> {
    // Create renderer
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      targetFps: 30,
    });
    this.renderer.setBackgroundColor('transparent');

    // Setup cleanup handlers for unexpected exits
    const cleanup = () => {
      if (this.renderer && !this.renderer.isDestroyed) {
        this.renderer.destroy();
      }
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    // Build UI
    this.buildLayout();
    this.setupKeyBindings();

    // Load initial data
    await this.loadData();

    // Initialize panel focus
    this.updatePanelFocus();

    // Start rendering
    this.isRunning = true;
    this.renderer.start();
  }

  /**
   * Build the UI layout
   */
  private buildLayout(): void {

    // Root container - add to renderer's root
    this.root = new BoxRenderable(this.renderer, {
      id: 'root',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    });
    this.renderer.root.add(this.root);

    // Header with colorful ASCII art
    this.header = new BoxRenderable(this.renderer, {
      id: 'header',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      height: 12,
    });

    // ASCII art lines with gradient colors
    const asciiLines = [
      { text: '╔══════════════════════════════════════════════════════════════╗', color: COLORS.asciiBox },
      { text: '║                                                              ║', color: COLORS.asciiBox },
      { text: '║   ███████╗██████╗  █████╗  ██████╗███████╗███████╗           ║', color: COLORS.gradient1, boxColor: COLORS.asciiBox },
      { text: '║   ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝           ║', color: COLORS.gradient2, boxColor: COLORS.asciiBox },
      { text: '║   ███████╗██████╔╝███████║██║     █████╗  ███████╗           ║', color: COLORS.gradient3, boxColor: COLORS.asciiBox },
      { text: '║   ╚════██║██╔═══╝ ██╔══██║██║     ██╔══╝  ╚════██║           ║', color: COLORS.gradient4, boxColor: COLORS.asciiBox },
      { text: '║   ███████║██║     ██║  ██║╚██████╗███████╗███████║           ║', color: COLORS.gradient5, boxColor: COLORS.asciiBox },
      { text: '║   ╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝           ║', color: COLORS.gradient6, boxColor: COLORS.asciiBox },
      { text: '║                                                              ║', color: COLORS.asciiBox },
      { text: '║                    worktree manager                          ║', color: COLORS.subtitle, boxColor: COLORS.asciiBox },
      { text: '║                                                              ║', color: COLORS.asciiBox },
      { text: '╚══════════════════════════════════════════════════════════════╝', color: COLORS.asciiBox },
    ];

    for (const line of asciiLines) {
      const textLine = new TextRenderable(this.renderer, {
        id: `splash-${asciiLines.indexOf(line)}`,
        content: line.text,
        fg: line.color,
      });
      this.header.add(textLine);
    }

    this.root.add(this.header);

    // Main content area (two panels)
    this.mainContent = new BoxRenderable(this.renderer, {
      id: 'main-content',
      flexDirection: 'row',
      flexGrow: 1,
      width: '100%',
      gap: 1,
      paddingLeft: 1,
      paddingRight: 1,
    });

    // Project panel (left)
    this.projectPanel = new BoxRenderable(this.renderer, {
      id: 'project-panel',
      flexGrow: 1,
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.borderFocused,
    });

    this.projectTitle = new TextRenderable(this.renderer, {
      id: 'project-title',
      content: ' Projects ',
      fg: COLORS.title,
      paddingLeft: 1,
    });
    this.projectPanel.add(this.projectTitle);

    this.projectSelect = new SelectRenderable(this.renderer, {
      id: 'project-select',
      options: [],
      showDescription: true,
      flexGrow: 1,
    });
    this.projectPanel.add(this.projectSelect);
    this.mainContent.add(this.projectPanel);

    // Workspace panel (right)
    this.workspacePanel = new BoxRenderable(this.renderer, {
      id: 'workspace-panel',
      flexGrow: 2,
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.border,
    });

    this.workspaceTitle = new TextRenderable(this.renderer, {
      id: 'workspace-title',
      content: ' Workspaces ',
      fg: COLORS.title,
      paddingLeft: 1,
    });
    this.workspacePanel.add(this.workspaceTitle);

    this.workspaceSelect = new SelectRenderable(this.renderer, {
      id: 'workspace-select',
      options: [],
      showDescription: true,
      flexGrow: 1,
    });
    this.workspacePanel.add(this.workspaceSelect);

    this.emptyWorkspaceText = new TextRenderable(this.renderer, {
      id: 'empty-workspace',
      content: 'Select a project first',
      fg: COLORS.textDim,
      paddingLeft: 2,
      paddingTop: 1,
    });
    this.workspacePanel.add(this.emptyWorkspaceText);

    this.mainContent.add(this.workspacePanel);
    this.root.add(this.mainContent);

    // Status bar
    this.statusBar = new BoxRenderable(this.renderer, {
      id: 'status-bar',
      width: '100%',
      height: 1,
      backgroundColor: COLORS.statusBar,
    });

    this.statusText = new TextRenderable(this.renderer, {
      id: 'status-text',
      content: ' [↑↓] Navigate  [←→] Switch  [Enter] Select  [n] New  [d] Delete  [?] Help  [q] Quit',
      fg: COLORS.textDim,
    });
    this.statusBar.add(this.statusText);
    this.root.add(this.statusBar);

    // Build dialog overlay (hidden by default)
    this.buildDialog();

    // Note: We handle Enter key manually in setupKeyBindings for both panels
    // This gives us more control over the flow (e.g., showing confirmation dialogs)
  }

  /**
   * Build dialog overlay
   */
  private buildDialog(): void {
    // Overlay covers the whole screen
    this.dialogOverlay = new BoxRenderable(this.renderer, {
      id: 'dialog-overlay',
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
    });
    this.dialogOverlay.visible = false;

    // Dialog box
    this.dialogBox = new BoxRenderable(this.renderer, {
      id: 'dialog-box',
      width: 50,
      height: 8,
      borderStyle: 'single',
      borderColor: COLORS.borderFocused,
      backgroundColor: '#222222',
      flexDirection: 'column',
      padding: 1,
    });

    this.dialogTitle = new TextRenderable(this.renderer, {
      id: 'dialog-title',
      content: 'New Workspace',
      fg: COLORS.title,
    });
    this.dialogBox.add(this.dialogTitle);

    this.dialogMessage = new TextRenderable(this.renderer, {
      id: 'dialog-message',
      content: '',
      fg: COLORS.text,
      paddingTop: 1,
    });
    this.dialogBox.add(this.dialogMessage);

    this.dialogInput = new InputRenderable(this.renderer, {
      id: 'dialog-input',
      width: 40,
      placeholder: 'Enter workspace name...',
    });
    this.dialogBox.add(this.dialogInput);

    this.dialogHint = new TextRenderable(this.renderer, {
      id: 'dialog-hint',
      content: '[Enter] Confirm  [Esc] Cancel',
      fg: COLORS.textDim,
      paddingTop: 1,
    });
    this.dialogBox.add(this.dialogHint);

    this.dialogOverlay.add(this.dialogBox);
    this.root.add(this.dialogOverlay);

    // Handle input enter
    this.dialogInput.on(InputRenderableEvents.ENTER, async () => {
      if (this.dialogMode === 'new-workspace') {
        await this.createNewWorkspace(this.dialogInput.value);
      }
    });
  }

  /**
   * Setup keyboard bindings
   */
  private setupKeyBindings(): void {
    this.renderer.keyInput.on('keypress', async (key: KeyEvent) => {
      if (!this.isRunning) return;

      // Handle dialog mode keys first
      if (this.dialogMode !== 'none') {
        await this.handleDialogKey(key);
        return;
      }

      // Quit
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        await this.quit();
        return;
      }

      // Tab or left/right to switch panels
      if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
        this.dispatch({ type: 'SWITCH_PANEL' });
        this.updatePanelFocus();
        return;
      }

      // Up/Down or j/k to navigate within current panel
      if (key.name === 'up' || key.name === 'k') {
        if (this.state.activePanel === 'projects') {
          const newIndex = Math.max(0, this.state.selectedProjectIndex - 1);
          this.dispatch({ type: 'SELECT_PROJECT', index: newIndex });
          this.projectSelect.selectedIndex = newIndex;
        } else {
          const newIndex = Math.max(0, this.state.selectedWorkspaceIndex - 1);
          this.dispatch({ type: 'SELECT_WORKSPACE', index: newIndex });
          this.workspaceSelect.selectedIndex = newIndex;
        }
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        if (this.state.activePanel === 'projects') {
          const newIndex = Math.min(this.state.projects.length - 1, this.state.selectedProjectIndex + 1);
          this.dispatch({ type: 'SELECT_PROJECT', index: newIndex });
          this.projectSelect.selectedIndex = newIndex;
        } else {
          const newIndex = Math.min(this.state.workspaces.length - 1, this.state.selectedWorkspaceIndex + 1);
          this.dispatch({ type: 'SELECT_WORKSPACE', index: newIndex });
          this.workspaceSelect.selectedIndex = newIndex;
        }
        return;
      }

      // Enter to select/open
      if (key.name === 'return' || key.name === 'enter') {
        if (this.state.activePanel === 'projects' && this.state.projects.length > 0) {
          const project = this.state.projects[this.state.selectedProjectIndex];
          if (project) {
            await this.selectProject(project.name);
          }
        } else if (this.state.activePanel === 'workspaces' && this.state.workspaces.length > 0) {
          const workspace = this.state.workspaces[this.state.selectedWorkspaceIndex];
          if (workspace && this.state.currentProject) {
            this.showWorkspaceActionsDialog(this.state.currentProject, workspace.name);
          }
        }
        return;
      }

      // New workspace (n)
      if (key.name === 'n') {
        if (this.state.currentProject) {
          this.showNewWorkspaceDialog();
        }
      }

      // Delete (d)
      if (key.name === 'd') {
        if (this.state.activePanel === 'workspaces' && this.state.workspaces.length > 0) {
          const workspace = this.state.workspaces[this.state.selectedWorkspaceIndex];
          if (workspace) {
            this.showDeleteConfirmDialog('workspace', workspace.name);
          }
        }
      }

      // Help (?)
      if (key.name === '?' || (key.shift && key.name === '/')) {
        this.showHelpDialog();
      }

      // Refresh (r)
      if (key.name === 'r') {
        await this.refresh();
      }
    });

    // Handle resize
    this.renderer.on('resize', () => {
      // Renderer handles resize automatically
    });
  }

  /**
   * Handle key press in dialog mode
   */
  private async handleDialogKey(key: KeyEvent): Promise<void> {
    // Escape to close dialog
    if (key.name === 'escape') {
      this.closeDialog();
      return;
    }

    // Handle confirm delete
    if (this.dialogMode === 'confirm-delete') {
      if (key.name === 'y') {
        await this.confirmDelete();
      } else if (key.name === 'n' || key.name === 'escape') {
        this.closeDialog();
      }
      return;
    }

    // Handle workspace actions
    if (this.dialogMode === 'workspace-actions') {
      if (key.name === 'o' || key.name === 'return' || key.name === 'enter') {
        // Open shell
        if (this.pendingWorkspaceAction) {
          const { projectName, workspaceName } = this.pendingWorkspaceAction;
          this.closeDialog();
          await this.openWorkspace(projectName, workspaceName);
        }
      } else if (key.name === 'c') {
        // Cancel
        this.closeDialog();
      }
      return;
    }

    // Handle help dialog
    if (this.dialogMode === 'help') {
      // Any key closes help
      this.closeDialog();
      return;
    }
  }

  /**
   * Show new workspace dialog
   */
  private showNewWorkspaceDialog(): void {
    this.dialogMode = 'new-workspace';
    this.dialogTitle.content = 'New Workspace';
    this.dialogMessage.content = `Create workspace in ${this.state.currentProject}:`;
    this.dialogMessage.visible = true;
    this.dialogInput.visible = true;
    this.dialogInput.value = '';
    this.dialogHint.content = '[Enter] Create  [Esc] Cancel';
    this.dialogOverlay.visible = true;
    this.dialogInput.focus();
  }

  /**
   * Show delete confirmation dialog
   */
  private showDeleteConfirmDialog(type: 'workspace', name: string): void {
    this.dialogMode = 'confirm-delete';
    this.pendingDelete = { type, name };
    this.dialogTitle.content = 'Confirm Delete';
    this.dialogMessage.content = `Delete ${type} "${name}"?`;
    this.dialogMessage.visible = true;
    this.dialogInput.visible = false;
    this.dialogHint.content = '[y] Yes  [n] No';
    this.dialogOverlay.visible = true;
  }

  /**
   * Show help dialog
   */
  private showHelpDialog(): void {
    this.dialogMode = 'help';
    this.dialogTitle.content = 'Keyboard Shortcuts';
    this.dialogMessage.content = [
      'Enter    Open selected workspace',
      'Tab/←/→  Switch between panels',
      '↑/↓/j/k  Navigate list',
      'n        New workspace',
      'd        Delete selected workspace',
      'r        Refresh lists',
      '?        Show this help',
      'q        Quit',
    ].join('\n');
    this.dialogMessage.visible = true;
    this.dialogInput.visible = false;
    this.dialogHint.content = 'Press any key to close';
    this.dialogOverlay.visible = true;
  }

  /**
   * Show workspace actions dialog
   */
  private showWorkspaceActionsDialog(projectName: string, workspaceName: string): void {
    this.dialogMode = 'workspace-actions';
    this.pendingWorkspaceAction = { projectName, workspaceName };
    this.dialogTitle.content = `Workspace: ${workspaceName}`;
    this.dialogMessage.content = 'What would you like to do?';
    this.dialogMessage.visible = true;
    this.dialogInput.visible = false;
    this.dialogHint.content = '[o/Enter] Open Shell  [c/Esc] Cancel';
    this.dialogOverlay.visible = true;
  }

  /**
   * Close dialog
   */
  private closeDialog(): void {
    this.dialogMode = 'none';
    this.pendingDelete = null;
    this.pendingWorkspaceAction = null;
    this.dialogOverlay.visible = false;
    this.dialogInput.blur();
  }

  /**
   * Create new workspace
   */
  private async createNewWorkspace(name: string): Promise<void> {
    if (!name.trim() || !this.state.currentProject) {
      this.closeDialog();
      return;
    }

    this.closeDialog();

    // Stop rendering for workspace creation
    this.isRunning = false;
    this.renderer.stop();
    process.stdout.write('\x1b[2J\x1b[H');

    try {
      await addWorkspace(name.trim(), { noShell: false });
    } catch (error) {
      // Will be handled when TUI resumes
    }

    // Resume TUI
    this.isRunning = true;
    this.renderer.start();

    // Refresh data
    await this.loadWorkspacesForProject(this.state.currentProject);
  }

  /**
   * Confirm and execute delete
   */
  private async confirmDelete(): Promise<void> {
    if (!this.pendingDelete || !this.state.currentProject) {
      this.closeDialog();
      return;
    }

    const { type, name } = this.pendingDelete;
    this.closeDialog();

    if (type === 'workspace') {
      // Stop rendering
      this.isRunning = false;
      this.renderer.stop();
      process.stdout.write('\x1b[2J\x1b[H');

      try {
        await removeWorkspace(name, { force: true });
      } catch (error) {
        // Will be handled when TUI resumes
      }

      // Resume TUI
      this.isRunning = true;
      this.renderer.start();

      // Refresh data
      await this.loadWorkspacesForProject(this.state.currentProject);
    }
  }

  /**
   * Refresh all data
   */
  private async refresh(): Promise<void> {
    const projects = loadProjects();
    this.dispatch({ type: 'SET_PROJECTS', projects });

    const projectOptions = projects.map((p) => ({
      name: p.name,
      value: p.name,
      description: `${p.repository} (${p.workspaceCount} workspaces)${p.isCurrent ? ' - current' : ''}`,
    }));
    this.projectSelect.options = projectOptions;

    if (this.state.currentProject) {
      await this.loadWorkspacesForProject(this.state.currentProject);
    }
  }

  /**
   * Dispatch state action
   */
  private dispatch(action: StateAction): void {
    this.state = stateReducer(this.state, action);
  }

  /**
   * Load initial data
   */
  private async loadData(): Promise<void> {
    this.dispatch({ type: 'SET_LOADING', loading: true });

    try {
      // Load projects
      const projects = loadProjects();
      this.dispatch({ type: 'SET_PROJECTS', projects });

      if (projects.length === 0) {
        // No projects - show helpful message
        this.projectSelect.options = [];
        this.projectSelect.visible = false;
        this.projectTitle.content = ' Projects (none) ';
        this.emptyWorkspaceText.content = 'No projects found.\nRun: spaces add project';
        this.emptyWorkspaceText.visible = true;
        this.workspaceSelect.visible = false;
        this.dispatch({ type: 'SET_LOADING', loading: false });
        return;
      }

      // Update project select options
      const projectOptions = projects.map((p) => ({
        name: p.name,
        value: p.name,
        description: `${p.repository} (${p.workspaceCount} workspaces)${p.isCurrent ? ' - current' : ''}`,
      }));
      this.projectSelect.options = projectOptions;
      this.projectSelect.visible = true;

      // Find current project index
      const currentIndex = projects.findIndex((p) => p.isCurrent);
      if (currentIndex >= 0) {
        this.dispatch({ type: 'SELECT_PROJECT', index: currentIndex });
        this.dispatch({ type: 'SET_CURRENT_PROJECT', project: projects[currentIndex].name });
        this.projectSelect.selectedIndex = currentIndex;

        // Load workspaces for current project
        await this.loadWorkspacesForProject(projects[currentIndex].name);
      }

      this.dispatch({ type: 'SET_LOADING', loading: false });
    } catch (error) {
      this.dispatch({
        type: 'SET_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Log the error so we can see what's happening
      console.error('TUI loadData error:', error);
    }
  }

  /**
   * Load workspaces for a project
   */
  private async loadWorkspacesForProject(projectName: string): Promise<void> {
    const workspaces = await loadWorkspaces(projectName);
    this.dispatch({ type: 'SET_WORKSPACES', workspaces });

    if (workspaces.length > 0) {
      const workspaceOptions = workspaces.map((ws) => {
        let status = ws.uncommittedChanges > 0 ? `${ws.uncommittedChanges} changes` : 'clean';
        if (ws.isStale) status += ' (stale)';

        const branchInfo =
          ws.ahead > 0 || ws.behind > 0
            ? `[${ws.branch} +${ws.ahead} -${ws.behind}]`
            : `[${ws.branch}]`;

        return {
          name: ws.name,
          value: ws.name,
          description: `${branchInfo} ${status}`,
        };
      });
      this.workspaceSelect.options = workspaceOptions;
      this.workspaceTitle.content = ` Workspaces (${projectName}) `;

      // Show select, hide empty text
      this.workspaceSelect.visible = true;
      this.emptyWorkspaceText.visible = false;
    } else {
      this.workspaceSelect.options = [];
      this.workspaceTitle.content = ` Workspaces (${projectName}) `;
      this.emptyWorkspaceText.content = 'No workspaces. Press [n] to create one.';

      // Hide select, show empty text
      this.workspaceSelect.visible = false;
      this.emptyWorkspaceText.visible = true;
    }
  }

  /**
   * Update panel border colors based on focus
   */
  private updatePanelFocus(): void {
    if (this.state.activePanel === 'projects') {
      this.projectPanel.borderColor = COLORS.borderFocused;
      this.workspacePanel.borderColor = COLORS.border;
      this.projectSelect.focus();
      this.workspaceSelect.blur();
    } else {
      this.projectPanel.borderColor = COLORS.border;
      this.workspacePanel.borderColor = COLORS.borderFocused;
      this.projectSelect.blur();
      this.workspaceSelect.focus();
    }
  }

  /**
   * Select a project
   */
  private async selectProject(projectName: string): Promise<void> {
    setCurrentProject(projectName);
    this.dispatch({ type: 'SET_CURRENT_PROJECT', project: projectName });

    // Update projects to mark current
    const projects = this.state.projects.map((p) => ({
      ...p,
      isCurrent: p.name === projectName,
    }));
    this.dispatch({ type: 'SET_PROJECTS', projects });

    // Update project options
    const projectOptions = projects.map((p) => ({
      name: p.name,
      value: p.name,
      description: `${p.repository} (${p.workspaceCount} workspaces)${p.isCurrent ? ' - current' : ''}`,
    }));
    this.projectSelect.options = projectOptions;

    // Load workspaces
    await this.loadWorkspacesForProject(projectName);

    // Switch to workspace panel
    this.dispatch({ type: 'SET_ACTIVE_PANEL', panel: 'workspaces' });
    this.dispatch({ type: 'SELECT_WORKSPACE', index: 0 });
    this.updatePanelFocus();
  }

  /**
   * Open a workspace (suspend TUI, spawn shell, resume on exit)
   */
  private async openWorkspace(projectName: string, workspaceName: string): Promise<void> {
    const workspacesDir = getProjectWorkspacesDir(projectName);
    const workspacePath = join(workspacesDir, workspaceName);
    const config = readProjectConfig(projectName);

    // Hide all UI elements and render a blank frame before suspending
    this.root.visible = false;
    this.renderer.requestRender();

    // Give renderer a moment to draw the blank frame
    await new Promise(resolve => setTimeout(resolve, 50));

    // Now suspend
    this.isRunning = false;
    this.renderer.suspend();

    try {
      // Open shell (this blocks until shell exits)
      await openWorkspaceShell(workspacePath, projectName, config.repository, false);
    } catch (error) {
      // Ignore shell exit errors
    }

    // Resume TUI after shell exits
    this.isRunning = true;
    this.root.visible = true;
    this.renderer.resume();

    // Refresh workspace data
    await this.loadWorkspacesForProject(projectName);
  }

  /**
   * Quit the application
   */
  private async quit(): Promise<void> {
    this.isRunning = false;
    this.renderer.destroy();
    process.exit(0);
  }
}

/**
 * Launch the TUI
 */
export async function launchTUI(): Promise<void> {
  const app = new SpacesTUI();
  await app.start();
}

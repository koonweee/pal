import Observation
import SwiftUI

private let taskSecondaryText = Color.primary.opacity(0.75)

@Observable @MainActor final class OwnerTasksStore {
  private let service: any ChatService
  private(set) var tasks: [OwnerTask] = []
  private(set) var loading = false
  private(set) var error: String?
  private(set) var archiveOverrides: [String: Bool] = [:]
  private(set) var archiveError: String?
  private var archived = false

  init(service: any ChatService) { self.service = service }

  private func sortByActivity() {
    tasks.sort { ($0.lastActivityAt, $0.id) > ($1.lastActivityAt, $1.id) }
  }

  func isArchived(_ task: OwnerTask) -> Bool { archiveOverrides[task.id] ?? task.archived }

  func refresh(archived: Bool? = nil) async {
    if let archived { self.archived = archived }
    guard !loading else { return }
    loading = true
    defer { loading = false }
    do {
      var result: [OwnerTask] = []
      var after: String?
      repeat {
        try Task.checkCancellation()
        let page = try await service.tasks(after: after, archived: self.archived)
        result.append(contentsOf: page.tasks)
        after = page.after
      } while after != nil
      tasks = result
      sortByActivity()
      error = nil
    } catch is CancellationError {
    } catch { self.error = "Couldn’t refresh tasks. Try again." }
  }

  func apply(_ task: OwnerTask) {
    guard task.archived == archived else {
      tasks.removeAll { $0.id == task.id }
      return
    }
    if let index = tasks.firstIndex(where: { $0.id == task.id }) {
      guard task.version >= tasks[index].version else { return }
      tasks[index] = task
    } else {
      tasks.append(task)
    }
    sortByActivity()
  }

  func setArchived(_ id: String, archived: Bool) async {
    guard archiveOverrides[id] == nil else { return }
    archiveOverrides[id] = archived
    archiveError = nil
    defer { archiveOverrides[id] = nil }
    tasks.removeAll { $0.id == id }
    do {
      try await service.setTaskArchived(id, archived: archived)
    } catch {
      archiveError = "Couldn’t confirm the change. Refresh to check or try again."
      await refresh()
    }
  }

  func detail(_ id: String) async throws -> OwnerTask { try await service.taskDetail(id) }

  func conversation(_ id: String, key: String) async -> ConversationStore {
    let scoped = await service.scoped(to: id)
    return ConversationStore(service: scoped, taskId: id, key: key)
  }
}

struct OwnerTasksScreen: View {
  @Binding var selectedTab: String
  let store: OwnerTasksStore
  let storageKey: String
  @State private var showArchived = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    List {
      if let error = store.error {
        Text(error)
        Button("Retry") { Task { await store.refresh() } }
      }
      if let error = store.archiveError { Text(error).accessibilityIdentifier("archiveError") }
      ForEach(store.tasks) { task in
        NavigationLink(value: task.id) {
          HStack(spacing: PalTheme.spacing) {
            VStack(alignment: .leading, spacing: 8) {
              Text(task.title).font(.headline)
              Text(task.goal).font(.subheadline).foregroundStyle(taskSecondaryText)
              TaskStatusBadge(status: task.status)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(taskSecondaryText)
          }.taskSurface()
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("task-\(task.id)")
        .navigationLinkIndicatorVisibility(.hidden)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
          Button {
            Task { await store.setArchived(task.id, archived: !store.isArchived(task)) }
          } label: {
            Label(
              showArchived ? "Unarchive" : "Archive",
              systemImage: showArchived ? "tray.and.arrow.up" : "archivebox")
          }.tint(.orange)
        }
        .disabled(store.archiveOverrides[task.id] != nil)
      }
      .listRowInsets(
        EdgeInsets(top: 0, leading: PalTheme.spacing, bottom: 0, trailing: PalTheme.spacing)
      )
      .listRowBackground(Color.clear)
      .listRowSeparator(.hidden)
    }
    .listStyle(.plain)
    .listRowSpacing(PalTheme.spacing)
    .contentMargins(.vertical, PalTheme.spacing, for: .scrollContent)
    .scrollContentBackground(.hidden)
    .overlay {
      if store.tasks.isEmpty {
        if store.loading {
          ProgressView("Loading tasks")
        } else if store.error == nil {
          ContentUnavailableView(
            showArchived ? "No archived tasks" : "No tasks yet", systemImage: "checklist",
            description: Text(
              showArchived
                ? "Tasks you archive will appear here."
                : "Work Pal takes on for you will appear here."))
        }
      }
    }
    .animation(reduceMotion ? nil : .default, value: store.tasks.map(\.id))
    .navigationDestination(for: String.self) { taskId in
      TaskConversationScreen(
        selectedTab: $selectedTab, taskId: taskId,
        initialTask: store.tasks.first { $0.id == taskId }, store: store,
        storageKey: storageKey + ".task." + taskId)
    }
    .pageNavigation(selection: $selectedTab, archivedFilter: $showArchived)
    .background(PalTheme.contentBackground)
    .accessibilityLabel("Tasks")
    .refreshable { await store.refresh() }
    .task(id: showArchived) { await store.refresh(archived: showArchived) }
  }
}

private struct TaskConversationScreen: View {
  @Binding var selectedTab: String
  let taskId: String
  let initialTask: OwnerTask?
  let store: OwnerTasksStore
  let storageKey: String
  @State private var task: OwnerTask?
  @State private var conversation: ConversationStore?
  @State private var showsInfo = false

  var body: some View {
    Group {
      if let conversation {
        ChatScreen(store: conversation, selectedTab: $selectedTab)
      } else {
        ProgressView("Loading conversation")
      }
    }
    .navigationTitle(task?.title ?? "Task")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Task info", systemImage: "info.circle") { showsInfo = true }
          .labelStyle(.iconOnly)
          .disabled(task == nil)
      }
    }
    .sheet(isPresented: $showsInfo) {
      NavigationStack {
        Group {
          if let task {
            Form {
              Section("Goal") { Text(task.goal).textSelection(.enabled) }
              if let description = task.description, !description.isEmpty {
                Section("Description") { Text(description).textSelection(.enabled) }
              }
              Section("Status") { TaskStatusBadge(status: task.status) }
            }
          } else {
            ProgressView("Loading task")
          }
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) { Button("Done") { showsInfo = false } }
        }
      }
    }
    .task {
      task = initialTask
      async let detail = store.detail(taskId)
      conversation = await store.conversation(taskId, key: storageKey)
      if let updated = try? await detail { task = updated }
    }
    .task(id: conversation.map(ObjectIdentifier.init)) {
      if let conversation { await conversation.run() }
    }
  }
}

extension View {
  fileprivate func taskSurface() -> some View {
    self.padding(PalTheme.spacing)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(PalTheme.assistantBackground, in: .rect(cornerRadius: PalTheme.messageRadius))
  }
}

private struct TaskStatusBadge: View {
  let status: String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var symbol: String {
    switch status {
    case "in-progress": "arrow.triangle.2.circlepath"
    case "needs-input": "exclamationmark.circle"
    case "completed": "checkmark.circle"
    default: "clock"
    }
  }
  var body: some View {
    Label {
      Text(OwnerTask.label(status)).contentTransition(.opacity)
    } icon: {
      Image(systemName: symbol).contentTransition(.opacity)
    }
    .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: status)
    .labelStyle(.titleAndIcon).foregroundStyle(.primary)
    .font(.caption).padding(.horizontal, 9).padding(.vertical, 5)
    .background(.quaternary, in: Capsule())
  }
}

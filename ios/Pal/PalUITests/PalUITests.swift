import XCTest

@MainActor final class PalUITests: XCTestCase {
  private func launch(tasks: Bool = false, observeArrival: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-pal-fixture", "-pal-fixture-key", "pal.ui." + UUID().uuidString,
    ]
    if tasks { app.launchArguments.append("-pal-fixture-tasks") }
    if observeArrival { app.launchArguments.append("-pal-fixture-observe-arrival") }
    app.launch()
    return app
  }

  private func selectPage(_ name: String, in app: XCUIApplication) {
    let switcher = app.buttons["pageSwitcher"]
    XCTAssertTrue(switcher.waitForExistence(timeout: 10))
    switcher.tap()
    let page = app.buttons[name]
    XCTAssertTrue(page.waitForExistence(timeout: 3))
    page.tap()
  }

  func testMainChatSendsAndReconciles() {
    let app = launch(observeArrival: true)
    let composer = app.descendants(matching: .any)["chatComposer"]
    XCTAssertTrue(composer.waitForExistence(timeout: 10))

    let text = "Hello from Pal"
    composer.tap()
    composer.typeText(text)
    app.buttons["sendMessage"].tap()

    XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 3))
    XCTAssertTrue(
      app.descendants(matching: .any)["assistantTypingBubble"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["Fixture reply from Pal."].waitForExistence(timeout: 10))
    XCTAssertEqual(app.staticTexts.matching(identifier: text).count, 1)
    let readReceipt = app.staticTexts["messageReadReceipt"]
    XCTAssertTrue(readReceipt.waitForExistence(timeout: 3))
    XCTAssertEqual(app.staticTexts.matching(identifier: "messageReadReceipt").count, 1)
  }

  func testSingleImageLoadingPreservesVisibleFrame() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-pal-fixture", "-pal-fixture-key", "pal.ui." + UUID().uuidString,
      "-pal-fixture-image-count", "1",
    ]
    app.launch()
    let preview = app.buttons["Open image"]
    XCTAssertTrue(preview.waitForExistence(timeout: 10))
    XCTAssertTrue(preview.isHittable)
    let frame = preview.frame
    XCTAssertGreaterThan(frame.height, 100)
    // The fixture delays decoding by four seconds; image labels are merged into the button.
    Thread.sleep(forTimeInterval: 5)
    XCTAssertEqual(preview.frame.minY, frame.minY, accuracy: 1)
    XCTAssertEqual(preview.frame.height, frame.height, accuracy: 1)
  }

  func testTaskOpensDirectConversation() {
    let app = launch(tasks: true)
    selectPage("Tasks", in: app)

    let task = app.buttons["task-11111111-1111-4111-8111-111111111111"]
    XCTAssertTrue(task.waitForExistence(timeout: 5))
    task.tap()

    XCTAssertTrue(app.navigationBars["Plan the trip"].waitForExistence(timeout: 5))
    let composer = app.descendants(matching: .any)["chatComposer"]
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    composer.tap()
    composer.typeText("What is next?")
    app.buttons["sendMessage"].tap()
    XCTAssertTrue(app.staticTexts["Fixture reply from Pal."].waitForExistence(timeout: 10))

    app.buttons["Task info"].tap()
    XCTAssertTrue(app.staticTexts["Prepare a useful itinerary"].waitForExistence(timeout: 5))
  }

  func testLongConversationScrollingPerformance() throws {
    try XCTSkipUnless(
      ProcessInfo.processInfo.environment["PAL_PERFORMANCE"] == "1",
      "Set PAL_PERFORMANCE=1 to run the long-conversation benchmark")
    let app = XCUIApplication()
    app.launchArguments = [
      "-pal-fixture", "-pal-fixture-performance", "-pal-fixture-key",
      "pal.performance." + UUID().uuidString,
    ]
    app.launch()

    let conversation = app.descendants(matching: .any)["conversation"]
    XCTAssertTrue(conversation.waitForExistence(timeout: 30))
    XCTAssertTrue(app.staticTexts["Fixture message 200"].waitForExistence(timeout: 30))

    let options = XCTMeasureOptions()
    options.iterationCount = 5
    measure(
      metrics: [
        XCTOSSignpostMetric.scrollingAndDecelerationMetric,
        XCTHitchMetric(application: app),
        XCTCPUMetric(application: app),
        XCTMemoryMetric(application: app),
      ], options: options
    ) {
      conversation.swipeDown(velocity: .fast)
      conversation.swipeUp(velocity: .fast)
    }
  }

  func testMarkdownPaginationPreservesAnchor() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-pal-fixture", "-pal-fixture-pagination", "-pal-fixture-key",
      "pal.pagination." + UUID().uuidString,
    ]
    app.launch()

    let conversation = app.descendants(matching: .any)["conversation"]
    XCTAssertTrue(conversation.waitForExistence(timeout: 15))
    let loadEarlier = app.buttons["Load earlier messages"]
    for _ in 0..<20 where !loadEarlier.isHittable {
      conversation.swipeDown(velocity: .fast)
    }
    XCTAssertTrue(loadEarlier.isHittable)

    let anchor = app.staticTexts["Fixture message 56"]
    XCTAssertTrue(anchor.waitForExistence(timeout: 5))
    let before = anchor.frame.minY
    loadEarlier.tap()

    let earlier = app.staticTexts["Fixture message 54"]
    XCTAssertTrue(earlier.waitForExistence(timeout: 10))
    let settled = expectation(description: "Markdown layout settled")
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { settled.fulfill() }
    wait(for: [settled], timeout: 3)
    XCTAssertEqual(anchor.frame.minY, before, accuracy: 4)

    let start = conversation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
    let end = conversation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
    start.press(forDuration: 0.2, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
    let reverseStart = conversation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
    let reverseEnd = conversation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
    reverseStart.press(
      forDuration: 0.2, thenDragTo: reverseEnd, withVelocity: .slow, thenHoldForDuration: 0)
  }

  func testMarkdownHistoryTracksSlowDragsWithoutJumping() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-pal-fixture", "-pal-fixture-scroll", "-pal-fixture-markdown",
      "-pal-fixture-key", "pal.slow-drag." + UUID().uuidString,
    ]
    app.launch()
    let scroll = app.scrollViews["conversation"]
    XCTAssertTrue(scroll.waitForExistence(timeout: 15))
    for step in 0..<12 {
      let anchor = app.staticTexts.matching(
        NSPredicate(format: "label BEGINSWITH 'History item '")
      )
      .allElementsBoundByIndex.reversed().first { $0.isHittable && $0.frame.minY < 600 }
      guard let anchor else {
        XCTFail("No visible history heading at step \(step)")
        return
      }
      let label = anchor.label
      let before = anchor.frame.minY
      let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.3))
      start.press(
        forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 160)),
        withVelocity: .slow, thenHoldForDuration: 0.5)
      let movedAnchor = app.staticTexts[label]
      guard movedAnchor.exists else {
        XCTFail("History heading \(label) disappeared after drag \(step)")
        return
      }
      XCTAssertEqual(
        movedAnchor.frame.minY - before, 160, accuracy: 30,
        "Newly visible Markdown must not move the reading position beyond the drag")
    }
  }

  func testRichMarkdownPreservesStructureWithoutRemoteImages() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-pal-fixture", "-pal-fixture-rich", "-pal-fixture-key",
      "pal.rich-markdown." + UUID().uuidString,
    ]
    app.launch()

    XCTAssertTrue(app.staticTexts["Rich Markdown"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.links["example link"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Renderer"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["MarkdownUI"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Virtualized"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'let answer = 42'"))
        .firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.images["Remote content"].exists)
  }
}

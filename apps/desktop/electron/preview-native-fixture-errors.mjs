/** Native proof processes report fatal failures to the runner instead of opening Electron's error dialog. */
export function failNativeFixtureWithoutDialog(app) {
  const fail = error => {
    console.error(error)
    app.exit(1)
  }
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
}

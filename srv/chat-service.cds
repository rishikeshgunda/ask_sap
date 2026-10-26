// One action: the UI5 chat screen sends a message and gets an answer back.
// Only users with the role AskSapUser (role collection AskSap_User) may call it.
@path: 'chat'
@requires: 'AskSapUser'
service ChatService {

  type Turn      { role : String; content : String; }
  type ToolTrace { tool : String; args : String; }
  type Answer    { reply : String; trace : many ToolTrace; }

  action ask(message : String, history : many Turn) returns Answer;
}

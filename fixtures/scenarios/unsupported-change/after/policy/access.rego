package access

default allow := false

allow if {
  input.role == "support"
}

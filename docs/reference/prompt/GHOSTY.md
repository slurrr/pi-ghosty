```                                                                                                                                                      
--- BEGIN GHOSTY SCAFFOLDING ---                                                                                                                       
WORK MODE ACTIVATION: User says "let's work on...", "time to build...", "delegate task to X" → initiate session-checkpoint logic immediately + verify  
tool access with peer_tools → only THEN break down task AND propose delegation with bounds                                                               
                                                                                                                                                    
SESSION CHECKPOINT FLOW:                                                                                                                               
1. Before DELEGATION:                                                                                                                                  
a. Check if session-checkpoint exists (local, in current dir, or notes/session-checkpoint.md)                                                       
b. If exists and <5min → Refresh before proceeding                                                                                                  
c. If exists but >5min → Write RESUME_instructions or SKIP based on context                                                                         
d. If NO checkpoint → NEW SESSION (clear headers + next_step)                                                                                       
                                                                                                                                                    
2. Always Delegate Like This (Structure Required):                                                                                                     
- peer_tools() = CHECK peer abilities BEFORE delegation                                                                                             
- Task = One clear objective (no "look into" + "see what")                                                                                          
- Path = Bounded (current dir, or exact file if specified in your chat prompt)                                                                      
- Expected Output = FORMAT ONLY (markdown bullet list, JSON object {key: value}, 3-line summary, etc.)                                              
                                                                                                                                                    
3. Loop Safety:                                                                                                                                        
a. If delegate attempt fails (blocked tool, error) → DO NOT retry in same session unless 2/3 attempts exceeded                                      
b. If attempt count > 2 without progress → peer_report(BLOCKER: tool missing / data absent / ambiguity) + STOP                                      
c. Always fail-forward in reports, not loop-back: suggest alternative peer (if coder tools differ), OR ask user to clarify                          
                                                                                                                                                    
4. Output Format Rules:                                                                                                                                
- Always match requested output format EXACTLY                                                                                                      
- JSON: produce JSON only                                                                                                                           
- Markdown summary: no code, only plain language                                                                                                    
- Lists: use bullet numbers where asked; don't default to emojis unless user asked                                                                  
- Ask once if path is ambiguous → WAIT for explicit answer                                                                                          
                                                                                                                                                    
END SCAFFOLDING                                                                                                                                        
```      
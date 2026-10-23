const form=document.querySelector("#login-form");
const error=document.querySelector("#login-error");
form.addEventListener("submit",async event=>{
  event.preventDefault();error.hidden=true;
  const button=form.querySelector("button");button.disabled=true;
  try{
    const payload={username:form.elements.username.value,password:form.elements.password.value};
    const response=await fetch("/auth/login",{method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"Could not sign in");
    form.elements.password.value="";
    window.location.assign("/");
  }catch(err){error.textContent=err.message;error.hidden=false;button.disabled=false;}
});
